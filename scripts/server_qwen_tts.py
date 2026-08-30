#!/usr/bin/env python3
"""Qwen3-TTS 本地 HTTP 服务（默认 9883）

POST /tts         {"text": "...", "instruct": "声音描述"} -> audio/wav（VoiceDesign 设计音色）
POST /tts-clone   {"text": "...", "audio_b64": "...", "ref_text": "..."} -> audio/wav（Base 克隆固定音色）
POST /health -> {"ok": true}
GET  /status -> {"ok": true, "design": {...}, "clone": {...}, "timeoutSec": ...}

模型生成跑在独立子进程（server_qwen_worker.py）里；超时后主服务直接强杀并重建，
避免 mlx_audio 偶发挂起时留下不可回收的线程与模型实例。
"""
import base64
import json
import os
import select
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def _default_model_dir(env_name: str, repo_name: str, fallback: str) -> str:
    """优先用仓库内 models/，兼容老机器上的绝对路径。"""
    env = os.environ.get(env_name)
    if env:
        return env
    local = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "models", repo_name)
    if os.path.isdir(local):
        return local
    return fallback


MODEL_DIR = _default_model_dir(
    "QWEN_VD_MODEL",
    "Qwen3-TTS-12Hz-1.7B-VoiceDesign-5bit",
    "/Users/hetan/Documents/剧本围读/qwen3-tts-test/models/Qwen3-TTS-12Hz-1.7B-VoiceDesign-5bit",
)
CLONE_MODEL_DIR = _default_model_dir(
    "QWEN_BASE_MODEL",
    "Qwen3-TTS-12Hz-1.7B-Base-4bit",
    "/Users/hetan/Documents/剧本围读/qwen3-tts-test/models/Qwen3-TTS-12Hz-1.7B-Base-4bit",
)
REF_DIR = "/tmp/qwen3-tts-server/refs"
os.makedirs(REF_DIR, exist_ok=True)
WORKER_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "server_qwen_worker.py")

POOL_LOCK = threading.Lock()
DESIGN_WORKERS = max(1, int(os.environ.get("QWEN_DESIGN_POOL", "1")))
CLONE_WORKERS = max(1, int(os.environ.get("QWEN_CLONE_POOL", "1")))
JOB_TIMEOUT = int(
    os.environ.get("QWEN_JOB_TIMEOUT") or os.environ.get("QWEN_ACQUIRE_TIMEOUT") or "90"
)


class _SubprocessWorker:
    """一个模型子进程 + 串行锁。超时后 kill 并重建子进程。"""

    def __init__(self, model_dir: str, kind: str):
        self.model_dir = model_dir
        self.kind = kind
        self.lock = threading.Lock()
        self.state_lock = threading.Lock()
        self.proc = None
        self.busy = False
        self.started_at = 0.0
        self.last_error = None
        self._start()

    def _start(self):
        self.proc = subprocess.Popen(
            [sys.executable, WORKER_SCRIPT, "--kind", self.kind, "--model-dir", self.model_dir],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=None,
            text=True,
            bufsize=1,
        )
        with self.state_lock:
            self.busy = False
            self.started_at = 0.0

    def _respawn(self):
        try:
            if self.proc:
                self.proc.kill()
                try:
                    self.proc.wait(timeout=5)
                except Exception:
                    pass
        except Exception:
            pass
        self._start()

    def _readline(self, timeout: float):
        ready, _, _ = select.select([self.proc.stdout], [], [], timeout)
        if not ready:
            return None
        return self.proc.stdout.readline()

    def run(self, params: dict) -> bytes:
        with self.lock:
            with self.state_lock:
                self.busy = True
                self.started_at = time.time()
                self.last_error = None
            req = {"id": uuid.uuid4().hex, **params}
            try:
                self.proc.stdin.write(json.dumps(req, ensure_ascii=False) + "\n")
                self.proc.stdin.flush()
            except Exception:
                self._respawn()
                raise RuntimeError("模型进程写入失败，已重建，请重试")
            line = self._readline(JOB_TIMEOUT)
            with self.state_lock:
                self.busy = False
            if line is None or not line.strip():
                self._respawn()
                with self.state_lock:
                    self.last_error = "生成超时（%d 秒），已重建进程" % JOB_TIMEOUT
                raise TimeoutError("合成超时（%d 秒），已重启模型进程，请重试" % JOB_TIMEOUT)
            try:
                resp = json.loads(line.strip() or "{}")
            except Exception:
                self._respawn()
                raise RuntimeError("模型进程返回无法解析，已重建，请重试")
            if resp.get("error"):
                with self.state_lock:
                    self.last_error = resp["error"]
                raise RuntimeError(resp["error"])
            return base64.b64decode(resp.get("audio_b64") or "")

    def status(self) -> dict:
        with self.state_lock:
            running = time.time() - self.started_at if self.busy and self.started_at else 0
            return {
                "busy": self.busy,
                "runningSec": round(running, 1),
                "lastError": self.last_error,
            }


_design_workers = [_SubprocessWorker(MODEL_DIR, "design") for _ in range(DESIGN_WORKERS)]
_clone_workers = [_SubprocessWorker(CLONE_MODEL_DIR, "clone") for _ in range(CLONE_WORKERS)]
_worker_counter = 0


def _next_worker(workers):
    global _worker_counter
    with POOL_LOCK:
        worker = workers[_worker_counter % len(workers)]
        _worker_counter += 1
    return worker


def synth_design(text: str, instruct: str) -> bytes:
    return _next_worker(_design_workers).run({"text": text, "instruct": instruct})


def synth_clone(text: str, audio_b64: str, ref_text: str) -> bytes:
    ref_path = os.path.join(REF_DIR, uuid.uuid4().hex + ".wav")
    try:
        with open(ref_path, "wb") as f:
            f.write(base64.b64decode(audio_b64))
        return _next_worker(_clone_workers).run(
            {"text": text, "ref_path": ref_path, "ref_text": ref_text}
        )
    finally:
        try:
            os.remove(ref_path)
        except OSError:
            pass


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_GET(self):
        try:
            if self.path == "/health":
                self._json({"ok": True})
                return
            if self.path == "/status":
                self._json({
                    "ok": True,
                    "design": _design_workers[0].status() if _design_workers else None,
                    "clone": _clone_workers[0].status() if _clone_workers else None,
                    "timeoutSec": JOB_TIMEOUT,
                })
                return
            self.send_error(404)
        except Exception as e:
            self.send_error(500, str(e))

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            if self.path == "/health":
                self._json({"ok": True})
                return
            if self.path in ("/tts", "/tts-clone"):
                text = str(body.get("text", "")).strip()
                if not text:
                    self.send_error(400, "empty text")
                    return
                if self.path == "/tts":
                    data = synth_design(text, str(body.get("instruct", "")).strip())
                else:
                    audio_b64 = str(body.get("audio_b64", "")).strip()
                    ref_text = str(body.get("ref_text", "")).strip()
                    if not audio_b64:
                        self.send_error(400, "audio_b64 required")
                        return
                    data = synth_clone(text, audio_b64, ref_text)
                self.send_response(200)
                self.send_header("Content-Type", "audio/wav")
                self.send_header("Content-Length", str(len(data)))
                self._cors()
                self.end_headers()
                try:
                    self.wfile.write(data)
                except (BrokenPipeError, ConnectionResetError):
                    pass
                return
            self.send_error(404)
        except Exception as e:
            import traceback
            traceback.print_exc()
            try:
                self._json({"ok": False, "error": str(e)}, 503 if isinstance(e, TimeoutError) else 500)
            except Exception:
                pass

    def log_message(self, fmt, *args):
        sys.stderr.write("%s\n" % (fmt % args))


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "9883"))
    print("Qwen3-TTS server on http://127.0.0.1:%d" % port, flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
