#!/usr/bin/env python3
"""
OpenBDR Native Messaging Host
Handles direct file system logging with Suricata-style rotation.

Features:
- Time-based rotation (hourly Hive partitions)
- Size-based rotation (50MB limit)
- State persistence for crash recovery
- Browser session lifecycle handling
"""

import sys
import os
import json
import struct
import datetime
import threading
import signal
import traceback

# Configuration
DEFAULT_LOG_DIR = os.path.expanduser("~/.openbdr/logs")
STATE_FILE = os.path.expanduser("~/.openbdr/state.json")
CONFIG_FILE = os.path.expanduser("~/.openbdr/config.json")
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB
FLUSH_INTERVAL = 5  # seconds


class OpenBDRHost:
    def __init__(self):
        self.log_dir = DEFAULT_LOG_DIR
        self.current_file = None
        self.current_file_handle = None
        self.current_size = 0
        self.file_sequence = 1
        self.last_partition = None
        self.last_event_id = None
        self.buffer = []
        self.flush_timer = None
        self.running = True
        
        # Ensure directories exist
        os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
        
        # Load config and state
        self.load_config()
        self.load_state()
    
    def load_config(self):
        """Load configuration from file"""
        try:
            if os.path.exists(CONFIG_FILE):
                with open(CONFIG_FILE, 'r') as f:
                    config = json.load(f)
                    self.log_dir = config.get('logDir', DEFAULT_LOG_DIR)
        except Exception as e:
            self.log_error(f"Failed to load config: {e}")
    
    def save_config(self):
        """Save configuration to file"""
        try:
            os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
            with open(CONFIG_FILE, 'w') as f:
                json.dump({
                    'logDir': self.log_dir
                }, f, indent=2)
        except Exception as e:
            self.log_error(f"Failed to save config: {e}")
    
    def load_state(self):
        """Load state from file for crash recovery"""
        try:
            if os.path.exists(STATE_FILE):
                with open(STATE_FILE, 'r') as f:
                    state = json.load(f)
                    self.current_file = state.get('currentFile')
                    self.current_size = state.get('currentSize', 0)
                    self.file_sequence = state.get('fileSequence', 1)
                    self.last_partition = state.get('lastPartition')
                    self.last_event_id = state.get('lastEventId')
                    
                    # Resume existing file if it exists and is in current partition
                    if self.current_file and os.path.exists(self.current_file):
                        current_partition = self.get_partition_key()
                        if self.last_partition == current_partition:
                            self.current_file_handle = open(self.current_file, 'a')
                            self.current_size = os.path.getsize(self.current_file)
        except Exception as e:
            self.log_error(f"Failed to load state: {e}")
    
    def save_state(self):
        """Save state to file"""
        try:
            os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
            with open(STATE_FILE, 'w') as f:
                json.dump({
                    'currentFile': self.current_file,
                    'currentSize': self.current_size,
                    'fileSequence': self.file_sequence,
                    'lastPartition': self.last_partition,
                    'lastEventId': self.last_event_id,
                    'lastUpdated': datetime.datetime.now().isoformat()
                }, f, indent=2)
        except Exception as e:
            self.log_error(f"Failed to save state: {e}")
    
    def get_partition_path(self, dt=None):
        """Generate Hive-style partition path"""
        if dt is None:
            dt = datetime.datetime.now()
        return f"year={dt.year}/month={dt.month:02d}/day={dt.day:02d}/hour={dt.hour:02d}"
    
    def get_partition_key(self, dt=None):
        """Get partition key for comparison"""
        if dt is None:
            dt = datetime.datetime.now()
        return f"{dt.year}-{dt.month:02d}-{dt.day:02d}-{dt.hour:02d}"
    
    def get_filename(self):
        """Generate full filename for current partition"""
        partition = self.get_partition_path()
        return os.path.join(self.log_dir, partition, f"events_{self.file_sequence:03d}.jsonl")
    
    def check_rotation(self):
        """Check if we need to rotate the log file"""
        current_partition = self.get_partition_key()
        
        # Time-based rotation: new partition
        if self.last_partition != current_partition:
            self.rotate(reason='time')
            return True
        
        # Size-based rotation
        if self.current_size >= MAX_FILE_SIZE:
            self.rotate(reason='size')
            return True
        
        return False
    
    def rotate(self, reason='manual'):
        """Rotate to a new log file"""
        # Close current file
        if self.current_file_handle:
            self.current_file_handle.flush()
            self.current_file_handle.close()
            self.current_file_handle = None
        
        current_partition = self.get_partition_key()
        
        # Reset sequence if new partition, otherwise increment
        if self.last_partition != current_partition:
            self.file_sequence = 1
            self.last_partition = current_partition
        else:
            self.file_sequence += 1
        
        # Create new file
        self.current_file = self.get_filename()
        os.makedirs(os.path.dirname(self.current_file), exist_ok=True)
        self.current_file_handle = open(self.current_file, 'a')
        self.current_size = 0
        
        self.log_error(f"Rotated log file ({reason}): {self.current_file}")
        self.save_state()
    
    def ensure_file_open(self):
        """Ensure we have an open log file"""
        if self.current_file_handle is None:
            self.last_partition = self.get_partition_key()
            self.current_file = self.get_filename()
            os.makedirs(os.path.dirname(self.current_file), exist_ok=True)
            self.current_file_handle = open(self.current_file, 'a')
            self.current_size = os.path.getsize(self.current_file) if os.path.exists(self.current_file) else 0
            self.save_state()
    
    def write_event(self, event):
        """Write an event to the log file"""
        self.check_rotation()
        self.ensure_file_open()
        
        event_json = json.dumps(event, separators=(',', ':'))
        line = event_json + '\n'
        
        self.current_file_handle.write(line)
        self.current_size += len(line.encode('utf-8'))
        self.last_event_id = event.get('eventId')
        
        # Flush periodically (buffered for performance)
        self.buffer.append(event)
        if len(self.buffer) >= 10:
            self.flush()
    
    def flush(self):
        """Flush buffer to disk"""
        if self.current_file_handle:
            self.current_file_handle.flush()
            os.fsync(self.current_file_handle.fileno())
        self.buffer = []
        self.save_state()
    
    def handle_message(self, message):
        """Handle incoming message from extension"""
        msg_type = message.get('type')
        
        if msg_type == 'SESSION_START':
            self.ensure_file_open()
            # Log session start event
            self.write_event({
                'timestamp': datetime.datetime.now().isoformat(),
                'eventId': f"session-{int(datetime.datetime.now().timestamp() * 1000)}",
                'eventType': 'session.start',
                'payload': message.get('payload', {})
            })
            return {'success': True, 'file': self.current_file}
        
        elif msg_type == 'SESSION_END':
            # Log session end event
            self.write_event({
                'timestamp': datetime.datetime.now().isoformat(),
                'eventId': f"session-{int(datetime.datetime.now().timestamp() * 1000)}",
                'eventType': 'session.end',
                'payload': message.get('payload', {})
            })
            self.flush()
            self.close()
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
            return {
                'success': True,
                'connected': True,
                'logDir': self.log_dir,
                'currentFile': self.current_file,
                'currentSize': self.current_size,
                'currentSizeMB': round(self.current_size / 1024 / 1024, 2),
                'currentPartition': self.get_partition_path(),
                'fileSequence': self.file_sequence,
                'lastEventId': self.last_event_id
            }
        
        elif msg_type == 'SET_CONFIG':
            config = message.get('config', {})
            if 'logDir' in config:
                self.log_dir = config['logDir']
                self.save_config()
                # Force rotation to new directory
                self.rotate(reason='config_change')
            return {'success': True, 'logDir': self.log_dir}
        
        elif msg_type == 'FLUSH':
            self.flush()
            return {'success': True}
        
        elif msg_type == 'PING':
            return {'success': True, 'pong': True}
        
        else:
            return {'success': False, 'error': f'Unknown message type: {msg_type}'}
    
    def close(self):
        """Clean shutdown"""
        if self.current_file_handle:
            self.current_file_handle.flush()
            self.current_file_handle.close()
            self.current_file_handle = None
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
