#!/usr/bin/env python3
import json
import os
import shutil
import sys

MANIFEST = {
    "name": "com.tbcollector.host",
    "description": "淘宝采集桌面端 Native Messaging Host",
    "path": os.path.abspath(os.path.join(os.path.dirname(__file__), "native_host.py")),
    "type": "stdio",
    "allowed_origins": [],
}

NM_DIR = os.path.expanduser("~/Library/Application Support/Google/Chrome/NativeMessagingHosts")


def install(extension_id: str):
    MANIFEST["allowed_origins"] = [f"chrome-extension://{extension_id}/"]
    os.makedirs(NM_DIR, exist_ok=True)
    dest = os.path.join(NM_DIR, "com.tbcollector.host.json")
    with open(dest, "w") as f:
        json.dump(MANIFEST, f, indent=2)
    host_path = MANIFEST["path"]
    os.chmod(host_path, 0o755)
    print(f"已安装 Native Messaging Host: {dest}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python install_host.py <chrome-extension-id>")
        sys.exit(1)
    install(sys.argv[1])
