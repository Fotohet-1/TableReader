#!/usr/bin/env python3
"""以独立会话启动后台命令，宿主会话结束后服务仍存活。

用法：python3 detach.py LOG_PATH CMD [ARGS...]
"""
import subprocess
import sys

if len(sys.argv) < 3:
    raise SystemExit("usage: detach.py LOG_PATH CMD [ARGS...]")

log_path, cmd = sys.argv[1], sys.argv[2:]
with open(log_path, "ab") as f:
    subprocess.Popen(
        cmd,
        stdout=f,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        start_new_session=True,
    )
