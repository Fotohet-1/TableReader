#!/usr/bin/env python3
"""edge-tts 本地 HTTP 服务（微软在线 TTS，免费）
POST /voices -> {音色名: {category, source_name}}
POST /tts  {"text": ..., "voice_id": "zh-CN-YunxiNeural"} -> audio/wav
POST /health -> {"ok": true}
速度接近实时，支持并发；输出 16bit PCM wav。
"""
import json, os, sys, io, asyncio, base64, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import numpy as np

PITCH_VARIANTS = [(-20, "低沉"), (-10, "微沉"), (0, "原声"), (10, "微亮"), (20, "清亮")]

VOICE_LIST = [
  ("zh-CN-XiaoxiaoNeural", "晓晓", "女"),
  ("zh-CN-XiaoyiNeural", "晓伊", "女"),
  ("zh-CN-YunjianNeural", "云健", "男"),
  ("zh-CN-YunxiNeural", "云希", "男"),
  ("zh-CN-YunxiaNeural", "云夏", "男"),
  ("zh-CN-YunyangNeural", "云扬", "男"),
  ("zh-CN-liaoning-XiaobeiNeural", "小北", "女"),
  ("zh-CN-shaanxi-XiaoniNeural", "小妮", "女"),
  ("zh-HK-HiuGaaiNeural", "曉佳", "女"),
  ("zh-HK-HiuMaanNeural", "曉曼", "女"),
  ("zh-HK-WanLungNeural", "雲龍", "男"),
  ("zh-TW-HsiaoChenNeural", "曉臻", "女"),
  ("zh-TW-HsiaoYuNeural", "曉雨", "女"),
  ("zh-TW-YunJheNeural", "雲哲", "男")
]

def parse_voice(v: str):
    if "#" in v:
        base, suffix = v.split("#", 1)
        val = int(suffix[1:]) * (1 if suffix[0] == "p" else -1)
        return base, ("+%dHz" % val if val > 0 else "%dHz" % val)
    return v, None


def synth(text: str, voice: str):
    import edge_tts
    import soundfile as sf
    base_voice, pitch = parse_voice(voice)

    async def _stream():
        kwargs = {}
        if pitch:
            kwargs["pitch"] = pitch
        communicate = edge_tts.Communicate(text, base_voice, **kwargs)
        buf = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                buf.write(chunk["data"])
        return buf.getvalue()

    mp3 = asyncio.run(_stream())
    data, sr = sf.read(io.BytesIO(mp3), dtype="float32")
    if data.ndim > 1:
        data = data.mean(axis=1)
    out = io.BytesIO()
    sf.write(out, data, sr, format="WAV", subtype="PCM_16")
    return out.getvalue(), int(len(data) / sr * 1000)

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
            if self.path == "/voices":
                view = {}
                for vid, name, g in VOICE_LIST:
                    for pv, label in PITCH_VARIANTS:
                        key = vid if pv == 0 else vid + ("#p%d" % pv if pv > 0 else "#m%d" % abs(pv))
                        view[key] = {"category": g, "source_name": name + ("" if pv == 0 else "·" + label)}
                self._json(view)
                return
            self.send_error(404)
        except Exception as e:
            self.send_error(500, str(e).encode("ascii", "replace").decode("ascii"))

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            if self.path == "/health":
                self._json({"ok": True})
                return
            if self.path == "/tts":
                text = str(body.get("text", "")).strip()
                voice = str(body.get("voice_id", "zh-CN-XiaoxiaoNeural"))
                if not text:
                    self.send_error(400, "empty text")
                    return
                data, dur_ms = synth(text, voice)
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
            self.send_error(500, str(e).encode("ascii", "replace").decode("ascii"))

    def log_message(self, fmt, *args):
        sys.stderr.write("%s\n" % (fmt % args))

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "9882"))
    print("edge-tts server on http://127.0.0.1:%d" % port, flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
