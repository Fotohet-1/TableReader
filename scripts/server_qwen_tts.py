#!/usr/bin/env python3
"""Qwen3-TTS 本地 HTTP 服务（默认 9883）
POST /tts         {"text": "...", "instruct": "声音描述"} -> audio/wav（VoiceDesign 设计音色）
POST /tts-clone   {"text": "...", "audio_b64": "...", "ref_text": "..."} -> audio/wav（Base 克隆固定音色）
POST /health -> {"ok": true}
模型路径可用 QWEN_VD_MODEL / QWEN_BASE_MODEL 覆盖；生成超时（默认 180 秒）
用 QWEN_JOB_TIMEOUT 调整（兼容旧名 QWEN_ACQUIRE_TIMEOUT）。默认每类模型
一个 worker 线程，QWEN_DESIGN_POOL / QWEN_CLONE_POOL 可调大。
"""
import base64
import io
import json
import os
import queue
import threading
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

POOL_LOCK = threading.Lock()
# 单 worker 线程持有模型实例，加载/生成都在同一个线程里串行执行，
# 避免 MLX 模型实例跨线程复用导致偶发挂起。默认每类模型一个 worker。
DESIGN_WORKERS = max(1, int(os.environ.get("QWEN_DESIGN_POOL", "1")))
CLONE_WORKERS = max(1, int(os.environ.get("QWEN_CLONE_POOL", "1")))
JOB_TIMEOUT = int(
    os.environ.get("QWEN_JOB_TIMEOUT") or os.environ.get("QWEN_ACQUIRE_TIMEOUT") or "180"
)


def _load_model(model_dir: str):
    from mlx_audio.tts.utils import load_model

    print("加载模型:", model_dir.split("/")[-1], flush=True)
    return load_model(model_dir)


def _model_generate(model, text: str, *, instruct=None, ref_path=None, ref_text=None) -> bytes:
    import numpy as np
    import soundfile as sf

    gen = model.generate(
        text=text,
        lang_code="zh",
        instruct=instruct,
        ref_audio=ref_path,
        ref_text=ref_text,
        verbose=False,
    )
    chunks = []
    sample_rate = 24000
    for r in gen:
        chunks.append(np.asarray(r.audio, dtype=np.float32))
        sample_rate = r.sample_rate
    if not chunks:
        raise RuntimeError("合成失败：模型未返回音频")
    audio = np.concatenate(chunks)
    buf = io.BytesIO()
    sf.write(buf, audio, sample_rate, format="WAV", subtype="PCM_16")
    return buf.getvalue()


class _Job:
    __slots__ = ("params", "result", "error", "done")

    def __init__(self, params: dict):
        self.params = params
        self.result = None
        self.error = None
        self.done = threading.Event()


class _ModelWorker:
    """单线程模型 worker：模型加载/生成只在一个线程里完成。

    某次生成超时时，HTTP 线程会调用 restart() 启动新 worker；旧 worker 完成
    当前任务后发现自己世代过期会自行退出，不会再抢新任务。
    """

    def __init__(self, model_dir: str):
        self.model_dir = model_dir
        self.queue: "queue.Queue[_Job]" = queue.Queue()
        self._epoch_lock = threading.Lock()
        self._epoch = 0
        self._start()

    def _start(self):
        with self._epoch_lock:
            self._epoch += 1
            epoch = self._epoch
        thread = threading.Thread(target=self._loop, args=(epoch,), daemon=True)
        thread.start()

    def _loop(self, epoch: int):
        model = None
        while True:
            try:
                job = self.queue.get(timeout=0.5)
            except queue.Empty:
                with self._epoch_lock:
                    if epoch != self._epoch:
                        return
                continue
            with self._epoch_lock:
                if epoch != self._epoch:
                    return
            try:
                if model is None:
                    model = _load_model(self.model_dir)
                job.result = _model_generate(model, **job.params)
            except Exception as e:
                job.error = e
                model = None  # 异常后丢弃实例，下次重新加载，避免坏状态复用
            finally:
                job.done.set()

    def submit(self, job: _Job):
        self.queue.put(job)

    def restart(self):
        self._start()


_design_workers = [_ModelWorker(MODEL_DIR) for _ in range(DESIGN_WORKERS)]
_clone_workers = [_ModelWorker(CLONE_MODEL_DIR) for _ in range(CLONE_WORKERS)]
_worker_counter = 0


def _next_worker(workers: list):
    global _worker_counter
    with POOL_LOCK:
        worker = workers[_worker_counter % len(workers)]
        _worker_counter += 1
    return worker


def _run_job(worker: _ModelWorker, params: dict) -> bytes:
    job = _Job(params)
    worker.submit(job)
    if not job.done.wait(timeout=JOB_TIMEOUT):
        worker.restart()
        raise TimeoutError("合成超时（%d 秒），已重置模型 worker，请重试" % JOB_TIMEOUT)
    if job.error:
        raise job.error
    return job.result


def synth_design(text: str, instruct: str) -> bytes:
    return _run_job(_next_worker(_design_workers), {"text": text, "instruct": instruct})


def synth_clone(text: str, audio_b64: str, ref_text: str) -> bytes:
    ref_path = os.path.join(REF_DIR, uuid.uuid4().hex + ".wav")
    try:
        with open(ref_path, "wb") as f:
            f.write(base64.b64decode(audio_b64))
        return _run_job(
            _next_worker(_clone_workers),
            {"text": text, "ref_path": ref_path, "ref_text": ref_text},
        )
    finally:
        try:
            os.remove(ref_path)
        except OSError:
            pass


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, obj):
        body = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
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
            if self.path == "/tts":
                text = str(body.get("text", "")).strip()
                instruct = str(body.get("instruct", "")).strip()
                if not text:
                    self.send_error(400, "empty text")
                    return
                data = synth_design(text, instruct)
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
            if self.path == "/tts-clone":
                text = str(body.get("text", "")).strip()
                audio_b64 = str(body.get("audio_b64", "")).strip()
                ref_text = str(body.get("ref_text", "")).strip()
                if not text or not audio_b64:
                    self.send_error(400, "text and audio_b64 required")
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
        import sys

        sys.stderr.write("%s\n" % (fmt % args))


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "9883"))
    print("Qwen3-TTS VoiceDesign server on http://127.0.0.1:%d" % port, flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
