#!/usr/bin/env python3
"""Qwen3-TTS 本地 HTTP 服务（默认 9883）
POST /tts         {"text": "...", "instruct": "声音描述"} -> audio/wav（VoiceDesign 设计音色）
POST /tts-clone   {"text": "...", "audio_b64": "...", "ref_text": "..."} -> audio/wav（Base 克隆固定音色）
POST /health -> {"ok": true}
模型路径可用环境变量 QWEN_VD_MODEL / QWEN_BASE_MODEL 覆盖。
"""
import base64
import io
import json
import os
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL_DIR = os.environ.get(
    "QWEN_VD_MODEL",
    "/Users/hetan/Documents/剧本围读/qwen3-tts-test/models/Qwen3-TTS-12Hz-1.7B-VoiceDesign-5bit",
)
CLONE_MODEL_DIR = os.environ.get(
    "QWEN_BASE_MODEL",
    "/Users/hetan/Documents/剧本围读/qwen3-tts-test/models/Qwen3-TTS-12Hz-1.7B-Base-4bit",
)
REF_DIR = "/tmp/qwen3-tts-server/refs"
os.makedirs(REF_DIR, exist_ok=True)

POOL_LOCK = threading.Lock()
DESIGN_POOL_SIZE = int(os.environ.get("QWEN_DESIGN_POOL", "2"))
CLONE_POOL_SIZE = int(os.environ.get("QWEN_CLONE_POOL", "2"))
_design_pool: list = []
_clone_pool: list = []


def _load_model(model_dir: str):
    from mlx_audio.tts.utils import load_model

    print("加载模型:", model_dir.split("/")[-1], flush=True)
    return load_model(model_dir)


def _acquire(pool: list, model_dir: str):
    with POOL_LOCK:
        if pool:
            return pool.pop()
    return _load_model(model_dir)


def _release(pool: list, model):
    with POOL_LOCK:
        if len(pool) < 4:
            pool.append(model)


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


def synth_design(text: str, instruct: str) -> bytes:
    model = _acquire(_design_pool, MODEL_DIR)
    try:
        return _model_generate(model, text, instruct=instruct)
    finally:
        _release(_design_pool, model)


def synth_clone(text: str, audio_b64: str, ref_text: str) -> bytes:
    model = _acquire(_clone_pool, CLONE_MODEL_DIR)
    ref_path = os.path.join(REF_DIR, uuid.uuid4().hex + ".wav")
    try:
        with open(ref_path, "wb") as f:
            f.write(base64.b64decode(audio_b64))
        return _model_generate(model, text, ref_path=ref_path, ref_text=ref_text)
    finally:
        _release(_clone_pool, model)
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
                self.send_error(500)
            except Exception:
                pass

    def log_message(self, fmt, *args):
        import sys

        sys.stderr.write("%s\n" % (fmt % args))


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "9883"))
    print("Qwen3-TTS VoiceDesign server on http://127.0.0.1:%d" % port, flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
