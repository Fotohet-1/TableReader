#!/usr/bin/env python3
"""剧本围读存档服务（默认 9884）
GET  /list?dir=...              -> 列出目录下的存档项目
GET  /meta?dir=...&id=...       -> 读取项目 meta.json
POST /meta {"dir":..., "id":..., "meta":{...}} -> 写项目 meta.json
POST /audio (raw wav) headers X-Archive-Dir / X-Project-Id / X-Unit-Id -> 写音频
GET  /audio?dir=...&id=...&unit=... -> 返回音频（播放）
POST /playback {"dir":..., "id":..., "currentIdx":..., "globalMs":...} -> 更新播放进度
POST /health -> {"ok": true}
"""
import json
import os
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

META_LOCK = threading.Lock()
PROJECT_FIELDS = ("scriptText", "units", "voices")
STATE_FIELDS = ("id", "name", "source", "audio", "playback")


def safe_child(base: str, *parts: str) -> str:
    base = os.path.abspath(os.path.expanduser(base))
    path = os.path.abspath(os.path.join(base, *parts))
    if not path.startswith(base + os.sep) and path != base:
        raise ValueError("路径越界")
    return path


def read_meta(base: str, pid: str):
    p = safe_child(base, pid, "meta.json")
    if not os.path.exists(p):
        return None
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)


def read_project(base: str, pid: str):
    p = safe_child(base, pid, "project.json")
    if not os.path.exists(p):
        return None
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)


def read_combined(base: str, pid: str):
    state = read_meta(base, pid) or {}
    project = read_project(base, pid)
    if project:
        return {**project, **state}
    return state


def atomic_write(path: str, obj: dict):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def write_meta(base: str, pid: str, meta: dict):
    folder = safe_child(base, pid)
    os.makedirs(folder, exist_ok=True)
    state = {k: meta[k] for k in STATE_FIELDS if k in meta}
    # 旧版单文件存档没有 project.json，写入进度时保留剧本字段，避免数据丢失
    if read_project(base, pid) is None:
        existing = read_meta(base, pid) or {}
        for k in PROJECT_FIELDS:
            if k in existing:
                state[k] = existing[k]
    state["updatedAt"] = time.strftime("%Y-%m-%d %H:%M:%S")
    atomic_write(os.path.join(folder, "meta.json"), state)


def write_project(base: str, pid: str, meta: dict):
    folder = safe_child(base, pid)
    os.makedirs(folder, exist_ok=True)
    p = os.path.join(folder, "project.json")
    project = {}
    if os.path.exists(p):
        with open(p, "r", encoding="utf-8") as f:
            project = json.load(f)
    for k in PROJECT_FIELDS:
        if k in meta:
            project[k] = meta[k]
    atomic_write(p, project)


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Archive-Dir, X-Project-Id, X-Unit-Id")

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length) or b"{}")

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_GET(self):
        try:
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            if self.path.startswith("/health"):
                self._json({"ok": True})
                return
            if self.path.startswith("/list"):
                base = q.get("dir", [""])[0]
                base = os.path.abspath(os.path.expanduser(base or "~/Documents/剧本围读存档"))
                out = []
                if os.path.isdir(base):
                    for name in sorted(os.listdir(base)):
                        mp = os.path.join(base, name, "meta.json")
                        if not os.path.isfile(mp):
                            continue
                        try:
                            m = read_combined(base, name)
                            if not (m.get("units") or []):
                                continue
                            out.append({
                                "id": name,
                                "name": m.get("name", name),
                                "updatedAt": m.get("updatedAt", ""),
                                "units": len(m.get("units") or []),
                                "audio": len(m.get("audio") or {})
                            })
                        except Exception:
                            pass
                out.sort(key=lambda x: x.get("updatedAt", ""), reverse=True)
                self._json({"projects": out})
                return
            if self.path.startswith("/meta"):
                base = q.get("dir", [""])[0] or "~/Documents/剧本围读存档"
                pid = q.get("id", [""])[0]
                if read_meta(base, pid) is None:
                    self._json({"ok": False, "error": "not found"}, 404)
                else:
                    m = read_combined(base, pid)
                    self._json({"ok": True, "meta": m})
                return
            if self.path.startswith("/audio"):
                base = q.get("dir", [""])[0] or "~/Documents/剧本围读存档"
                pid = q.get("id", [""])[0]
                unit = q.get("unit", [""])[0]
                p = safe_child(base, pid, "audio", str(unit) + ".wav")
                if not os.path.isfile(p):
                    self.send_error(404)
                    return
                with open(p, "rb") as f:
                    data = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "audio/wav")
                self.send_header("Content-Length", str(len(data)))
                self._cors()
                self.end_headers()
                self.wfile.write(data)
                return
            self.send_error(404)
        except Exception as e:
            self._json({"ok": False, "error": str(e)}, 500)

    def do_POST(self):
        try:
            if self.path.startswith("/health"):
                self._json({"ok": True})
                return
            if self.path.startswith("/meta"):
                body = self._read_json()
                base = body.get("dir", "") or "~/Documents/剧本围读存档"
                pid = str(body.get("id", ""))
                meta = body.get("meta") or {}
                meta["updatedAt"] = time.strftime("%Y-%m-%d %H:%M:%S")
                with META_LOCK:
                    existing = read_meta(base, pid)
                    if existing and "playback" not in meta:
                        meta["playback"] = existing.get("playback", {"currentIdx": 0, "globalMs": 0})
                    write_project(base, pid, meta)
                    write_meta(base, pid, meta)
                self._json({"ok": True})
                return
            if self.path.startswith("/playback"):
                body = self._read_json()
                base = body.get("dir", "") or "~/Documents/剧本围读存档"
                pid = str(body.get("id", ""))
                with META_LOCK:
                    m = read_meta(base, pid) or {}
                    m["playback"] = {
                        "currentIdx": int(body.get("currentIdx", 0)),
                        "globalMs": int(body.get("globalMs", 0)),
                        "rate": float(body.get("rate", 1)),
                    }
                    m["updatedAt"] = time.strftime("%Y-%m-%d %H:%M:%S")
                    write_meta(base, pid, m)
                self._json({"ok": True})
                return
            if self.path.startswith("/audio"):
                length = int(self.headers.get("Content-Length", 0))
                data = self.rfile.read(length)
                base = urllib.parse.unquote(self.headers.get("X-Archive-Dir", "")) or "~/Documents/剧本围读存档"
                pid = self.headers.get("X-Project-Id", "")
                unit = self.headers.get("X-Unit-Id", "")
                p = safe_child(base, pid, "audio", str(unit) + ".wav")
                os.makedirs(os.path.dirname(p), exist_ok=True)
                with open(p, "wb") as f:
                    f.write(data)
                self._json({"ok": True})
                return
            self.send_error(404)
        except Exception as e:
            self._json({"ok": False, "error": str(e)}, 500)

    def log_message(self, fmt, *args):
        import sys
        sys.stderr.write("%s\n" % (fmt % args))


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "9884"))
    print("剧本围读存档服务 on http://127.0.0.1:%d" % port, flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
