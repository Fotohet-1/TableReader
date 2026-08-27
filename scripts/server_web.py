#!/usr/bin/env python3
"""剧本围读助手前端静态服务（默认 5174）：托管 dist/ 构建产物。"""
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dist")
PORT = int(os.environ.get("PORT", "5174"))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    if not os.path.isfile(os.path.join(ROOT, "index.html")):
        raise SystemExit("找不到 dist/index.html，请先构建前端：npm run build")
    print("前端静态服务 on http://127.0.0.1:%d" % PORT, flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
