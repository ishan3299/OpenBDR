#!/usr/bin/env python3
import sys
import struct
import json
import socket
import os

SOCKET_PATH = os.path.expanduser("~/.openbdr/openbdr.sock")

def talk_to_daemon(msg):
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.connect(SOCKET_PATH)
            s.sendall(json.dumps(msg).encode())
            # Wait for response
            resp_data = s.recv(1024*1024)
            if resp_data:
                return json.loads(resp_data.decode())
    except Exception as e:
        return {"success": False, "error": str(e)}
    return {"success": False, "error": "No response from daemon"}

while True:
    raw_len = sys.stdin.buffer.read(4)
    if not raw_len: break
    msg_len = struct.unpack('I', raw_len)[0]
    raw_msg = sys.stdin.buffer.read(msg_len)
    msg = json.loads(raw_msg.decode())
    
    # Forward to daemon and get ACTUAL response
    resp_obj = talk_to_daemon(msg)
    
    # Ensure _id is preserved for the browser callback
    if '_id' in msg: resp_obj['_id'] = msg['_id']
    
    resp = json.dumps(resp_obj).encode()
    sys.stdout.buffer.write(struct.pack('I', len(resp)))
    sys.stdout.buffer.write(resp)
    sys.stdout.buffer.flush()
