#!/usr/bin/env python3
"""剧本围读存档服务（默认 9884）—— 两级结构：剧集(series) -> 集(episode)。

工作区目录：
  {archiveDir}/{seriesId}/
    project.json          # 剧集元数据: id, name, source, episodes[]
    音色/
      bank.json           # 角色音色库: { roles: { roleBase: {...} } }
      seeds/{role}.wav    # Qwen 种子音频
    {episodeId}/
      project.json        # 该集的剧本结构(scriptText/units/voices)，只写一次
      meta.json           # 该集的音频+播放进度
      audio/{unit}.wav

常用端点：
  GET  /health
  GET  /list-series?dir=...        -> { series: [...] }
  GET  /series?dir&id               -> { series }
  POST /series {dir,id,name,source,episode?}
  GET  /episodes?dir&series         -> { episodes: [...] }
  GET  /meta?dir&series&id          -> { meta }（集的剧本+状态）
  POST /meta {dir,series,id,meta}
  POST /playback {dir,series,id,currentIdx,globalMs,rate}
  POST /audio (raw wav) headers X-Archive-Dir / X-Series-Id / X-Episode-Id / X-Unit-Id
  GET  /audio?dir&series&id&unit
  GET  /voicebank?dir&series        -> { bank }
  POST /voicebank {dir,series,bank}
  POST /seed (raw wav) headers X-Archive-Dir / X-Series-Id / X-Role
  GET  /seed?dir&series&role        -> audio/wav
"""
import json
import os
import re
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

META_LOCK = threading.Lock()
PROJECT_FIELDS = ("scriptText", "units", "voices")
STATE_FIELDS = ("id", "name", "source", "audio", "playback")
VOICE_DIR = "音色"


def safe_child(base: str, *parts: str) -> str:
    base = os.path.abspath(os.path.expanduser(base))
    path = os.path.abspath(os.path.join(base, *parts))
    if not path.startswith(base + os.sep) and path != base:
        raise ValueError("路径越界")
    return path


def slufify(name: str) -> str:
    """把角色名/集号转成安全文件名，避免路径问题。"""
    return re.sub(r"[^\w\u4e00-\u9fff.-]+", "_", name).strip("._")


def read_json(path: str):
    if not os.path.isfile(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def atomic_write(path: str, obj: dict):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def series_project(base: str, sid: str):
    p = safe_child(base, sid, "project.json")
    obj = read_json(p) or {"id": sid, "name": sid, "source": "", "episodes": []}
    obj.setdefault("episodes", [])
    return obj, safe_child(base, sid)


def episode_meta(base: str, sid: str, eid: str):
    folder = safe_child(base, sid, eid)
    state = read_json(os.path.join(folder, "meta.json")) or {}
    project = read_json(os.path.join(folder, "project.json"))
    if project:
        return {**project, **state}, folder
    return state, folder


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Archive-Dir, X-Series-Id, X-Episode-Id, X-Unit-Id, X-Role")

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

    def _query(self):
        return urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)

    def _base(self, q, key="dir"):
        return q.get(key, [""])[0] or "~/Documents/剧本围读存档"

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_GET(self):
        try:
            q = self._query()
            if self.path.startswith("/health"):
                self._json({"ok": True})
                return
            if self.path.startswith("/list-series"):
                base = self._base(q)
                base = os.path.abspath(os.path.expanduser(base))
                out = []
                if os.path.isdir(base):
                    for name in sorted(os.listdir(base)):
                        sp = os.path.join(base, name, "project.json")
                        if not os.path.isfile(sp):
                            continue
                        try:
                            m = read_json(sp)
                            eps = m.get("episodes") or []
                            if not eps:
                                continue  # 旧的单集项目没有剧集结构，隐藏
                            bank = read_json(os.path.join(base, name, VOICE_DIR, "bank.json")) or {}
                            roles = len(bank.get("roles") or {})
                            out.append({
                                "id": name,
                                "name": m.get("name", name),
                                "source": m.get("source", "edge"),
                                "updatedAt": m.get("updatedAt", ""),
                                "episodes": len(eps),
                                "voices": roles,
                            })
                        except Exception:
                            pass
                out.sort(key=lambda x: x.get("updatedAt", ""), reverse=True)
                self._json({"series": out})
                return
            if self.path.startswith("/series"):
                base = self._base(q)
                sid = q.get("id", [""])[0]
                proj, _ = series_project(base, sid)
                self._json({"ok": True, "series": proj})
                return
            if self.path.startswith("/episodes"):
                base = self._base(q)
                sid = q.get("series", [""])[0]
                proj, _ = series_project(base, sid)
                self._json({"ok": True, "episodes": proj.get("episodes") or []})
                return
            if self.path.startswith("/meta"):
                base = self._base(q)
                sid = q.get("series", [""])[0]
                eid = q.get("id", [""])[0]
                meta, _ = episode_meta(base, sid, eid)
                self._json({"ok": True, "meta": meta})
                return
            if self.path.startswith("/audio"):
                base = self._base(q)
                sid = q.get("series", [""])[0]
                eid = q.get("id", [""])[0]
                unit = q.get("unit", [""])[0]
                p = safe_child(base, sid, eid, "audio", str(unit) + ".wav")
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
            if self.path.startswith("/voicebank"):
                base = self._base(q)
                sid = q.get("series", [""])[0]
                p = safe_child(base, sid, VOICE_DIR, "bank.json")
                self._json({"ok": True, "bank": read_json(p) or {"roles": {}}})
                return
            if self.path.startswith("/seed"):
                base = self._base(q)
                sid = q.get("series", [""])[0]
                role = slufify(q.get("role", [""])[0])
                p = safe_child(base, sid, VOICE_DIR, "seeds", role + ".wav")
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
            if self.path.startswith("/series"):
                body = self._read_json()
                base = body.get("dir", "") or "~/Documents/剧本围读存档"
                sid = str(body.get("id", ""))
                proj, folder = series_project(base, sid)
                if "name" in body:
                    proj["name"] = body.get("name")
                if "source" in body and (not proj.get("source") or proj.get("source") == body.get("source")):
                    proj["source"] = body.get("source")
                ep = body.get("episode")
                if ep:
                    eid = str(ep.get("id", ""))
                    eps = proj.setdefault("episodes", [])
                    found = next((x for x in eps if x["id"] == eid), None)
                    rec = {
                        "id": eid,
                        "name": ep.get("name", eid),
                        "order": int(ep.get("order", len(eps) + 1)),
                    }
                    if found:
                        found.update(rec)
                    else:
                        eps.append(rec)
                proj["updatedAt"] = time.strftime("%Y-%m-%d %H:%M:%S")
                atomic_write(os.path.join(folder, "project.json"), proj)
                self._json({"ok": True, "series": proj})
                return
            if self.path.startswith("/meta"):
                body = self._read_json()
                base = body.get("dir", "") or "~/Documents/剧本围读存档"
                sid = str(body.get("series", ""))
                eid = str(body.get("id", ""))
                meta = body.get("meta") or {}
                folder = safe_child(base, sid, eid)
                with META_LOCK:
                    state = read_json(os.path.join(folder, "meta.json")) or {}
                    if "playback" not in meta and "playback" in state:
                        meta["playback"] = state["playback"]
                    if isinstance(state.get("audio"), dict) and isinstance(meta.get("audio"), dict):
                        meta["audio"] = {**state["audio"], **meta["audio"]}
                    project = {}
                    for k in PROJECT_FIELDS:
                        if k in meta:
                            project[k] = meta.pop(k)
                    if project:
                        atomic_write(os.path.join(folder, "project.json"), project)
                    state_out = {k: meta[k] for k in STATE_FIELDS if k in meta}
                    state_out["updatedAt"] = time.strftime("%Y-%m-%d %H:%M:%S")
                    atomic_write(os.path.join(folder, "meta.json"), state_out)
                self._json({"ok": True})
                return
            if self.path.startswith("/playback"):
                body = self._read_json()
                base = body.get("dir", "") or "~/Documents/剧本围读存档"
                sid = str(body.get("series", ""))
                eid = str(body.get("id", ""))
                folder = safe_child(base, sid, eid)
                with META_LOCK:
                    m = read_json(os.path.join(folder, "meta.json")) or {}
                    m["playback"] = {
                        "currentIdx": int(body.get("currentIdx", 0)),
                        "globalMs": int(body.get("globalMs", 0)),
                        "rate": float(body.get("rate", 1)),
                    }
                    m["updatedAt"] = time.strftime("%Y-%m-%d %H:%M:%S")
                    atomic_write(os.path.join(folder, "meta.json"), m)
                self._json({"ok": True})
                return
            if self.path.startswith("/audio"):
                length = int(self.headers.get("Content-Length", 0))
                data = self.rfile.read(length)
                q = self._query()
                base = q.get("dir", [""])[0] or "~/Documents/剧本围读存档"
                sid = q.get("series", [""])[0]
                eid = q.get("id", [""])[0]
                unit = q.get("unit", [""])[0]
                p = safe_child(base, sid, eid, "audio", unit + ".wav")
                os.makedirs(os.path.dirname(p), exist_ok=True)
                with open(p, "wb") as f:
                    f.write(data)
                self._json({"ok": True})
                return
            if self.path.startswith("/seed"):
                length = int(self.headers.get("Content-Length", 0))
                data = self.rfile.read(length)
                q = self._query()
                base = q.get("dir", [""])[0] or "~/Documents/剧本围读存档"
                sid = q.get("series", [""])[0]
                role = slufify(q.get("role", [""])[0])
                p = safe_child(base, sid, VOICE_DIR, "seeds", role + ".wav")
                os.makedirs(os.path.dirname(p), exist_ok=True)
                with open(p, "wb") as f:
                    f.write(data)
                self._json({"ok": True})
                return
            if self.path.startswith("/voicebank"):
                body = self._read_json()
                base = body.get("dir", "") or "~/Documents/剧本围读存档"
                sid = str(body.get("series", ""))
                bank = body.get("bank") or {}
                p = safe_child(base, sid, VOICE_DIR, "bank.json")
                bank["updatedAt"] = time.strftime("%Y-%m-%d %H:%M:%S")
                atomic_write(p, bank)
                self._json({"ok": True})
                return
            self.send_error(404)
        except Exception as e:
            import sys
            sys.stderr.write("%s\n" % e)
            self._json({"ok": False, "error": str(e)}, 500)

    def log_message(self, fmt, *args):
        import sys
        sys.stderr.write("%s\n" % (fmt % args))


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "9884"))
    print("剧本围读存档服务 on http://127.0.0.1:%d" % port, flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
