#!/usr/bin/env python3
import sys
import json
import struct


def read_message():
    raw_len = sys.stdin.buffer.read(4)
    if not raw_len:
        return None
    msg_len = struct.unpack("=I", raw_len)[0]
    return json.loads(sys.stdin.buffer.read(msg_len))


def send_message(msg):
    data = json.dumps(msg).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("=I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def main():
    while True:
        msg = read_message()
        if msg is None:
            break
        send_message({"ok": True, "echo": msg})


if __name__ == "__main__":
    main()
