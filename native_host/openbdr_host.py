#!/usr/bin/env python3
"""
OpenBDR Native Messaging Host
Handles direct system-level logging using SQLite.

Features:
- Structured storage with SQLite
- Time-based partitioning (stored as metadata in DB)
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

# Configuration
DEFAULT_BASE_DIR = os.path.expanduser("~/.openbdr")
CONFIG_FILE = os.path.join(DEFAULT_BASE_DIR, "config.json")
STATE_FILE = os.path.join(DEFAULT_BASE_DIR, "state.json")
DEFAULT_DB_FILE = os.path.join(DEFAULT_BASE_DIR, "openbdr.db")
FLUSH_BATCH_SIZE = 10  # Number of events before commit


class OpenBDRHost:
    def __init__(self):
        self.base_dir = DEFAULT_BASE_DIR
        self.db_file = DEFAULT_DB_FILE
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
    
    def load_config(self):
        """Load configuration from file"""
        try:
            if os.path.exists(CONFIG_FILE):
                with open(CONFIG_FILE, 'r') as f:
                    config = json.load(f)
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
                    'dbFile': self.db_file
                }, f, indent=2)
        except Exception as e:
            self.log_error(f"Failed to save config: {e}")

    def init_sqlite(self):
        """Initialize SQLite database"""
        try:
            os.makedirs(os.path.dirname(self.db_file), exist_ok=True)
            self.db_conn = sqlite3.connect(self.db_file)
            
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
                    metadata TEXT
                )
            ''')
            # Index for performance on time-based queries
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_timestamp ON events(timestamp)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_type ON events(eventType)')
            
            self.db_conn.commit()
            self.log_error(f"SQLite database initialized: {self.db_file}")
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
                "INSERT OR REPLACE INTO events (eventId, timestamp, eventType, payload, metadata) VALUES (?, ?, ?, ?, ?)",
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
    
    def handle_message(self, message):
        """Handle incoming message from extension"""
        msg_type = message.get('type')
        
        if msg_type == 'SESSION_START':
            # Log session start event
            self.write_event({
                'timestamp': datetime.datetime.now().isoformat(),
                'eventId': f"session-{int(datetime.datetime.now().timestamp() * 1000)}",
                'eventType': 'session.start',
                'payload': message.get('payload', {})
            })
            return {'success': True, 'db': self.db_file}
        
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
                
                # Get breakdown by type
                cursor.execute("SELECT eventType, COUNT(*) FROM events GROUP BY eventType")
                type_rows = cursor.fetchall()
                event_types = {row[0]: row[1] for row in type_rows}
                
            except Exception as e:
                self.log_error(f"Failed to fetch stats: {e}")
                total_events = 0
                event_types = {}

            return {
                'success': True,
                'connected': True,
                'storageType': 'SQLite',
                'dbFile': self.db_file,
                'totalEvents': total_events,
                'eventTypes': event_types,
                'lastEventId': self.last_event_id
            }
        
        elif msg_type == 'SET_CONFIG':
            config = message.get('config', {})
            if 'dbFile' in config:
                self.flush()
                self.db_conn.close()
                self.db_file = config['dbFile']
                self.init_sqlite()
                self.save_config()

            return {'success': True, 'dbFile': self.db_file}
        
        elif msg_type == 'FLUSH':
            self.flush()
            return {'success': True}
        
        elif msg_type == 'PING':
            return {'success': True, 'pong': True}
        
        else:
            return {'success': False, 'error': f'Unknown message type: {msg_type}'}
    
    def close(self):
        """Clean shutdown"""
        if self.db_conn:
            try:
                self.db_conn.commit()
                self.db_conn.close()
            except:
                pass
            self.db_conn = None
        self.save_state()
    
    def log_error(self, message):
        """Log error to stderr (visible in Chrome's extension error log)"""
        sys.stderr.write(f"[OpenBDR Host] {message}\n")
        sys.stderr.flush()


# Native messaging protocol helpers
def read_message():
    """Read a message from stdin using Chrome's native messaging protocol"""
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length:
        return None
    message_length = struct.unpack('I', raw_length)[0]
    message = sys.stdin.buffer.read(message_length).decode('utf-8')
    return json.loads(message)


def send_message(message):
    """Send a message to stdout using Chrome's native messaging protocol"""
    encoded = json.dumps(message).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('I', len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def main():
    """Main entry point"""
    host = OpenBDRHost()
    
    def cleanup(signum=None, frame=None):
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
