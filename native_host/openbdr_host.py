#!/usr/bin/env python3
"""
OpenBDR Native Messaging Host
Handles direct system-level logging using SQLite and optional remote forwarding.

Features:
- Structured storage with SQLite
- Background log forwarding via HTTP
- Automatic transaction management
- State persistence for crash recovery
- Browser session lifecycle handling
"""

import sys
import os
import json
import struct
import datetime
import signal
import traceback
import sqlite3
import threading
import time
import urllib.request

# Configuration
DEFAULT_BASE_DIR = os.path.expanduser("~/.openbdr")
CONFIG_FILE = os.path.join(DEFAULT_BASE_DIR, "config.json")
STATE_FILE = os.path.join(DEFAULT_BASE_DIR, "state.json")
DEFAULT_DB_FILE = os.path.join(DEFAULT_BASE_DIR, "openbdr.db")
FLUSH_BATCH_SIZE = 10  # Number of events before commit
FORWARD_INTERVAL = 30  # Seconds between forwarding attempts
FORWARD_BATCH_SIZE = 50


DEBUG_LOG = os.path.join(DEFAULT_BASE_DIR, "host_debug.log")

def log_debug(msg):
    try:
        with open(DEBUG_LOG, "a") as f:
            f.write(f"{datetime.datetime.now().isoformat()} - {msg}\n")
    except:
        pass

class OpenBDRHost:
    def __init__(self):
        log_debug("Host initializing...")
        self.base_dir = DEFAULT_BASE_DIR
        self.db_file = DEFAULT_DB_FILE
        self.forwarding_url = None
        self.db_conn = None
        self.last_event_id = None
        self.buffer_count = 0
        self.running = True
        
        # Ensure base directory exists
        os.makedirs(self.base_dir, exist_ok=True)
        
        # Load config and state
        self.load_config()
        self.init_sqlite()
        self.load_state()

        # Start forwarding thread
        if self.forwarding_url:
            log_debug(f"Starting forwarding thread for {self.forwarding_url}")
            try:
                self.forward_thread = threading.Thread(target=self.forward_worker, daemon=True)
                self.forward_thread.start()
            except Exception as e:
                log_debug(f"Failed to start thread: {e}")
    
    def load_config(self):
        """Load configuration from file"""
        try:
            if os.path.exists(CONFIG_FILE):
                with open(CONFIG_FILE, 'r') as f:
                    config = json.load(f)
                    self.forwarding_url = config.get('forwardingUrl')
                    # Support legacy logDir if present, but default to base_dir
                    log_dir = config.get('logDir')
                    if log_dir:
                        self.db_file = os.path.join(log_dir, "openbdr.db")
                    else:
                        self.db_file = config.get('dbFile', DEFAULT_DB_FILE)
        except Exception as e:
            self.log_error(f"Failed to load config: {e}")
    
    def save_config(self):
        """Save configuration to file"""
        try:
            os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
            with open(CONFIG_FILE, 'w') as f:
                json.dump({
                    'dbFile': self.db_file,
                    'forwardingUrl': self.forwarding_url
                }, f, indent=2)
        except Exception as e:
            self.log_error(f"Failed to save config: {e}")

    def init_sqlite(self):
        """Initialize SQLite database"""
        try:
            os.makedirs(os.path.dirname(self.db_file), exist_ok=True)
            self.db_conn = sqlite3.connect(self.db_file, check_same_thread=False)
            
            # Optimization: Enable Write-Ahead Logging (WAL) for better concurrency
            self.db_conn.execute('PRAGMA journal_mode=WAL')
            self.db_conn.execute('PRAGMA synchronous=NORMAL')
            
            cursor = self.db_conn.cursor()
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS events (
                    eventId TEXT PRIMARY KEY,
                    timestamp TEXT,
                    eventType TEXT,
                    payload TEXT,
                    metadata TEXT,
                    forwarded INTEGER DEFAULT 0
                )
            ''')
            
            # Migration: Add forwarded column if it doesn't exist
            try:
                cursor.execute('ALTER TABLE events ADD COLUMN forwarded INTEGER DEFAULT 0')
            except sqlite3.OperationalError:
                pass # Already exists

            # Index for performance on time-based queries
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_timestamp ON events(timestamp)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_type ON events(eventType)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_forwarded ON events(forwarded)')
            
            self.db_conn.commit()
            log_debug(f"SQLite database initialized: {self.db_file}")
        except Exception as e:
            self.log_error(f"Failed to initialize SQLite: {e}")
            sys.exit(1)
    
    def load_state(self):
        """Load state from file for crash recovery"""
        try:
            if os.path.exists(STATE_FILE):
                with open(STATE_FILE, 'r') as f:
                    state = json.load(f)
                    self.last_event_id = state.get('lastEventId')
        except Exception as e:
            self.log_error(f"Failed to load state: {e}")
    
    def save_state(self):
        """Save state to file"""
        try:
            os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
            with open(STATE_FILE, 'w') as f:
                json.dump({
                    'dbFile': self.db_file,
                    'lastEventId': self.last_event_id,
                    'lastUpdated': datetime.datetime.now().isoformat()
                }, f, indent=2)
        except Exception as e:
            self.log_error(f"Failed to save state: {e}")
    
    def write_event(self, event):
        """Write an event to SQLite"""
        if not self.db_conn:
            return

        try:
            cursor = self.db_conn.cursor()
            
            cursor.execute(
                "INSERT OR REPLACE INTO events (eventId, timestamp, eventType, payload, metadata, forwarded) VALUES (?, ?, ?, ?, ?, 0)",
                (
                    event.get('eventId'),
                    event.get('timestamp'),
                    event.get('eventType'),
                    json.dumps(event.get('payload')),
                    json.dumps(event.get('metadata'))
                )
            )
            
            self.last_event_id = event.get('eventId')
            self.buffer_count += 1
            
            # Batch commits for performance
            if self.buffer_count >= FLUSH_BATCH_SIZE:
                self.flush()
                
        except Exception as e:
            self.log_error(f"Failed to insert into SQLite: {e}")
    
    def flush(self):
        """Commit transaction to disk"""
        if self.db_conn:
            try:
                self.db_conn.commit()
                self.buffer_count = 0
                self.save_state()
            except Exception as e:
                self.log_error(f"Failed to commit SQLite transaction: {e}")

    def forward_worker(self):
        """Background worker for log forwarding"""
        log_debug("Forwarding worker started")
        while self.running:
            try:
                if self.forwarding_url:
                    self.perform_forwarding()
            except Exception as e:
                self.log_error(f"Forwarding error: {e}")
            time.sleep(FORWARD_INTERVAL)

    def perform_forwarding(self):
        """Fetch and forward unforwarded events"""
        if not self.db_conn:
            return

        cursor = self.db_conn.cursor()
        cursor.execute(
            "SELECT eventId, timestamp, eventType, payload, metadata FROM events WHERE forwarded = 0 LIMIT ?",
            (FORWARD_BATCH_SIZE,)
        )
        rows = cursor.fetchall()
        
        if not rows:
            return

        log_debug(f"Attempting to forward {len(rows)} events")
        events = []
        event_ids = []
        for row in rows:
            events.append({
                'eventId': row[0],
                'timestamp': row[1],
                'eventType': row[2],
                'payload': json.loads(row[3]),
                'metadata': json.loads(row[4])
            })
            event_ids.append(row[0])

        # Attempt to send via HTTP
        try:
            data = json.dumps({'events': events}).encode('utf-8')
            req = urllib.request.Request(
                self.forwarding_url,
                data=data,
                headers={'Content-Type': 'application/json', 'User-Agent': 'OpenBDR-Host/1.0'}
            )
            with urllib.request.urlopen(req, timeout=10) as response:
                if 200 <= response.status < 300:
                    # Mark as forwarded
                    placeholders = ','.join(['?'] * len(event_ids))
                    cursor.execute(
                        f"UPDATE events SET forwarded = 1 WHERE eventId IN ({placeholders})",
                        event_ids
                    )
                    self.db_conn.commit()
                    log_debug(f"Successfully forwarded {len(events)} events")
                else:
                    self.log_error(f"Forwarding failed with status: {response.status}")
        except Exception as e:
            self.log_error(f"Failed to forward events to {self.forwarding_url}: {e}")
    
    def handle_message(self, message):
        """Handle incoming message from extension"""
        msg_type = message.get('type')
        log_debug(f"Handling message type: {msg_type}")
        
        if msg_type == 'SESSION_START':
            # Log session start event
            self.write_event({
                'timestamp': datetime.datetime.now().isoformat(),
                'eventId': f"session-{int(datetime.datetime.now().timestamp() * 1000)}",
                'eventType': 'session.start',
                'payload': message.get('payload', {})
            })
            return {'success': True, 'db': self.db_file, 'forwarding': self.forwarding_url is not None}
        
        elif msg_type == 'SESSION_END':
            # Log session end event
            self.write_event({
                'timestamp': datetime.datetime.now().isoformat(),
                'eventId': f"session-{int(datetime.datetime.now().timestamp() * 1000)}",
                'eventType': 'session.end',
                'payload': message.get('payload', {})
            })
            self.flush()
            return {'success': True}
        
        elif msg_type == 'LOG_EVENT':
            event = message.get('event', {})
            self.write_event(event)
            return {'success': True, 'eventId': event.get('eventId')}
        
        elif msg_type == 'LOG_BATCH':
            events = message.get('events', [])
            for event in events:
                self.write_event(event)
            self.flush()
            return {'success': True, 'count': len(events)}
        
        elif msg_type == 'GET_STATUS':
            try:
                cursor = self.db_conn.cursor()
                
                # Get total count
                cursor.execute("SELECT COUNT(*) FROM events")
                total_events = cursor.fetchone()[0]
                
                # Get forwarded count
                cursor.execute("SELECT COUNT(*) FROM events WHERE forwarded = 1")
                forwarded_events = cursor.fetchone()[0]
                
                # Get breakdown by type
                cursor.execute("SELECT eventType, COUNT(*) FROM events GROUP BY eventType")
                type_rows = cursor.fetchall()
                event_types = {row[0]: row[1] for row in type_rows}
                
            except Exception as e:
                self.log_error(f"Failed to fetch stats: {e}")
                total_events = 0
                forwarded_events = 0
                event_types = {}

            return {
                'success': True,
                'connected': True,
                'storageType': 'SQLite',
                'dbFile': self.db_file,
                'forwardingUrl': self.forwarding_url,
                'totalEvents': total_events,
                'forwardedEvents': forwarded_events,
                'eventTypes': event_types,
                'lastEventId': self.last_event_id
            }
        
        elif msg_type == 'SET_CONFIG':
            config = message.get('config', {})
            restart_forwarder = False
            
            if 'dbFile' in config:
                self.flush()
                self.db_conn.close()
                self.db_file = config['dbFile']
                self.init_sqlite()
            
            if 'forwardingUrl' in config:
                self.forwarding_url = config['forwardingUrl']
                restart_forwarder = True

            self.save_config()
            
            if restart_forwarder and self.forwarding_url:
                if not hasattr(self, 'forward_thread') or not self.forward_thread.is_alive():
                    self.forward_thread = threading.Thread(target=self.forward_worker, daemon=True)
                    self.forward_thread.start()

            return {'success': True, 'dbFile': self.db_file, 'forwardingUrl': self.forwarding_url}
        
        elif msg_type == 'FLUSH':
            self.flush()
            if self.forwarding_url:
                self.perform_forwarding()
            return {'success': True}
        
        elif msg_type == 'PING':
            return {'success': True, 'pong': True}
        
        else:
            return {'success': False, 'error': f'Unknown message type: {msg_type}'}
    
    def close(self):
        """Clean shutdown"""
        log_debug("Host closing...")
        self.running = False
        if self.db_conn:
            try:
                self.db_conn.commit()
                self.db_conn.close()
            except:
                pass
            self.db_conn = None
        self.save_state()
    
    def log_error(self, message):
        """Log error to stderr and debug file"""
        log_debug(f"ERROR: {message}")
        sys.stderr.write(f"[OpenBDR Host] {message}\n")
        sys.stderr.flush()


# Native messaging protocol helpers
def read_message():
    """Read a message from stdin using Chrome's native messaging protocol"""
    try:
        raw_length = sys.stdin.buffer.read(4)
        if not raw_length:
            return None
        message_length = struct.unpack('I', raw_length)[0]
        message = sys.stdin.buffer.read(message_length).decode('utf-8')
        return json.loads(message)
    except Exception as e:
        sys.stderr.write(f"[OpenBDR Host] Error reading message: {e}\n")
        sys.stderr.flush()
        return None


def send_message(message):
    """Send a message to stdout using Chrome's native messaging protocol"""
    try:
        encoded = json.dumps(message).encode('utf-8')
        sys.stdout.buffer.write(struct.pack('I', len(encoded)))
        sys.stdout.buffer.write(encoded)
        sys.stdout.buffer.flush()
    except Exception as e:
        sys.stderr.write(f"[OpenBDR Host] Error sending message: {e}\n")
        sys.stderr.flush()


def main():
    """Main entry point"""
    sys.stderr.write("[OpenBDR Host] Starting main loop...\n")
    sys.stderr.flush()
    host = OpenBDRHost()
    
    def cleanup(signum=None, frame=None):
        sys.stderr.write(f"[OpenBDR Host] Cleaning up (Signal: {signum})...\n")
        sys.stderr.flush()
        host.close()
        sys.exit(0)
    
    # Handle signals for clean shutdown
    signal.signal(signal.SIGTERM, cleanup)
    signal.signal(signal.SIGINT, cleanup)
    
    try:
        while True:
            message = read_message()
            if message is None:
                break
            
            try:
                response = host.handle_message(message)
                # Echo back the message ID for the JS callback system
                if '_id' in message:
                    response['_id'] = message['_id']
                send_message(response)
            except Exception as e:
                host.log_error(f"Error handling message: {e}\n{traceback.format_exc()}")
                send_message({'success': False, 'error': str(e)})
    except Exception as e:
        host.log_error(f"Fatal error: {e}\n{traceback.format_exc()}")
    finally:
        cleanup()


if __name__ == '__main__':
    main()
