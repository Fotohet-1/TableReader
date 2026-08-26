#!/usr/bin/env python3
"""Qwen3-TTS VoiceDesign 本地 HTTP 服务（默认 9883）
POST /tts  {"text": "...", "instruct": "声音描述"} -> audio/wav
POST /health -> {"ok": true}
模型路径可用环境变量 QWEN_VD_MODEL 覆盖。
"""
import glob
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL_DIR = os.environ.get(
    "QWEN_VD_MODEL",
    "/Users/hetan/Documents/剧本围读/qwen3-tts-test/models/Qwen3-TTS-12Hz-1.7B-VoiceDesign-5bit",
)
OUT_DIR = "/tmp/qwen3-tts-server"
LOCK = threading.Lock()


def synth(text: str, instruct: str) -> bytes:
    from mlx_audio.tts.generate import generate_audio

    os.makedirs(OUT_DIR, exist_ok=True)
    for f in glob.glob(os.path.join(OUT_DIR, "out_*.wav")):
        os.remove(f)
    with LOCK:
        generate_audio(
            model=MODEL_DIR,
            text=text,
            lang_code="zh",
            instruct=instruct,
            output_path=OUT_DIR,
            file_prefix="out",
            save=True,
            verbose=False,
        )
    files = sorted(glob.glob(os.path.join(OUT_DIR, "out_*.wav")))
    if not files:
        raise RuntimeError("合成失败：未生成音频文件")
    with open(files[-1], "rb") as f:
        return f.read()


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
                data = synth(text, instruct)
                self.send_response(200)
                self.send_header("Content-Type", "audio/wav")
                self.send_header("Content-Length", str(len(data)))
                self._cors()
                self.end_headers()
                self.wfile.write(data)
                return
            self.send_error(404)
        except Exception as e:
            import traceback

            traceback.print_exc()
            self.send_error(500, str(e))

    def log_message(self, fmt, *args):
        import sys

        sys.stderr.write("%s\n" % (fmt % args))


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "9883"))
    print("Qwen3-TTS VoiceDesign server on http://127.0.0.1:%d" % port, flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
