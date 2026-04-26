#!/usr/bin/env python3
import socket
import json
import sqlite3
import os
import threading
import datetime
import time
import urllib.request
import sys

BASE_DIR = os.path.expanduser("~/.openbdr")
DB_FILE = os.path.join(BASE_DIR, "logs/openbdr.db")
CONFIG_FILE = os.path.join(BASE_DIR, "config.json")
SOCKET_PATH = os.path.join(BASE_DIR, "openbdr.sock")

class OpenBDRDaemon:
    def __init__(self):
        os.makedirs(os.path.dirname(DB_FILE), exist_ok=True)
        self.forwarding_url = None
        self.load_config()
        self.db_conn = sqlite3.connect(DB_FILE, check_same_thread=False)
        self.init_db()
        
    def load_config(self):
        if os.path.exists(CONFIG_FILE):
            with open(CONFIG_FILE, 'r') as f:
                config = json.load(f)
                self.forwarding_url = config.get('forwardingUrl')

    def init_db(self):
        cursor = self.db_conn.cursor()
        cursor.execute('''CREATE TABLE IF NOT EXISTS events 
            (eventId TEXT PRIMARY KEY, timestamp TEXT, eventType TEXT, payload TEXT, metadata TEXT, forwarded INTEGER DEFAULT 0)''')
        self.db_conn.commit()

    def log_event(self, event):
        cursor = self.db_conn.cursor()
        cursor.execute("INSERT OR REPLACE INTO events VALUES (?, ?, ?, ?, ?, 0)",
            (event.get('eventId'), event.get('timestamp'), event.get('eventType'), 
             json.dumps(event.get('payload')), json.dumps(event.get('metadata'))))
        self.db_conn.commit()

    def get_stats(self):
        cursor = self.db_conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM events")
        total = cursor.fetchone()[0]
        cursor.execute("SELECT eventType, COUNT(*) FROM events GROUP BY eventType")
        types = {row[0]: row[1] for row in cursor.fetchall()}
        return {"success": True, "totalEvents": total, "eventTypes": types, "connected": True, "dbFile": DB_FILE}

    def run(self):
        if os.path.exists(SOCKET_PATH): os.remove(SOCKET_PATH)
        server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        server.bind(SOCKET_PATH)
        os.chmod(SOCKET_PATH, 0o666)
        server.listen(10)
        
        while True:
            conn, _ = server.accept()
            threading.Thread(target=self.handle_client, args=(conn,), daemon=True).start()

    def handle_client(self, conn):
        try:
            with conn:
                data = conn.recv(1024*1024)
                if not data: return
                msg = json.loads(data.decode())
                resp = {"success": True}
                
                mtype = msg.get('type')
                if mtype == 'PING':
                    resp = {"success": True, "pong": True}
                elif mtype in ['LOG_EVENT', 'LOG_BATCH']:
                    events = msg.get('events', [msg.get('event')])
                    for e in events: self.log_event(e)
                elif mtype == 'GET_STATUS':
                    resp = self.get_stats()
                elif mtype == 'SESSION_START':
                    resp = {"success": True, "db": DB_FILE}
                
                if '_id' in msg: resp['_id'] = msg['_id']
                conn.sendall(json.dumps(resp).encode())
        except Exception as e:
            pass

if __name__ == "__main__":
    daemon = OpenBDRDaemon()
    daemon.run()
