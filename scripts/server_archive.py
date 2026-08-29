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
  GET  /check-dir?dir               -> { ok, isDir, parentOk }
  POST /pick-dir                    -> { ok, dir }（macOS 系统文件夹选择）
  GET  /full-audio-info?dir&series&id -> { ok, exists, path, durationMs }（整集完整音频是否存在）
  GET  /full-audio?dir&series&id     -> audio/wav（整集完整音频）
  POST /stitch {dir,series,id}      -> { ok, durationMs, units, missing, path }（按播放器时间轴拼接整集音频）
  POST /reveal {dir,series,id}      -> { ok, path }（在访达中显示整集音频）
"""
import json
import os
import re
import subprocess
import threading
import time
import urllib.parse
import wave
import array
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


def safe_name(name: str) -> str:
    """文件名只剥离路径非法字符，保留空格与中文。"""
    return re.sub(r"[\\/:*?\"<>|]+", "-", name).strip()


def full_audio_path(base: str, sid: str, eid: str) -> str:
    """整集完整音频路径：{工作区}/{剧集}/{集}/{剧名} {集名} 完整音频.wav"""
    proj, _ = series_project(base, sid)
    series_name = proj.get("name") or sid
    episode_name = eid
    for ep in proj.get("episodes") or []:
        if ep.get("id") == eid:
            episode_name = ep.get("name") or eid
            break
    fn = safe_name("%s %s 完整音频.wav" % (series_name, episode_name))
    return safe_child(base, sid, eid, fn)


def _dur_of_uid(infos, audio_map, uid):
    if uid in infos:
        p = infos[uid][0]
        return p.nframes / p.framerate * 1000
    return (audio_map.get(str(uid)) or {}).get("durationMs") or 0


def render_stitch(base: str, sid: str, eid: str):
    """按播放器时间轴（同 group 重叠、其余按序）拼接整集音频，返回统计。"""
    ep_folder = safe_child(base, sid, eid)
    ep_proj = read_json(os.path.join(ep_folder, "project.json")) or {}
    units = ep_proj.get("units") or []
    state = read_json(os.path.join(ep_folder, "meta.json")) or {}
    audio_map = state.get("audio") or {}
    audio_dir = os.path.join(ep_folder, "audio")

    text_units = [u for u in units if (u.get("text") or "").strip()]
    if not text_units:
        raise ValueError("该集没有可合成的文本")

    files = {}  # uid -> (Wave_params, frames_bytes)
    for u in text_units:
        p = os.path.join(audio_dir, str(u["id"]) + ".wav")
        if not os.path.isfile(p):
            continue
        try:
            with wave.open(p, "rb") as w:
                params = w.getparams()
                frames = w.readframes(w.getnframes())
            files[u["id"]] = (params, frames)
        except Exception:
            pass

    canon = None
    for u in text_units:
        if u["id"] in files:
            canon = files[u["id"]][0]
            break
    if canon is None:
        raise ValueError("该集单句音频缺失，无法拼接完整音频")

    def matches_canon(p):
        return p.nchannels == canon.nchannels and p.sampwidth == canon.sampwidth and p.framerate == canon.framerate

    infos = {uid: v for uid, v in files.items() if matches_canon(v[0])}
    if canon.nchannels != 1 or canon.sampwidth != 2:
        raise ValueError("完整音频拼接仅支持单声道 16-bit WAV（当前 %dch/%dbit）" % (canon.nchannels, canon.sampwidth * 8))

    rate = canon.framerate
    channels = canon.nchannels
    sampwidth = canon.sampwidth
    missing = sum(1 for u in text_units if u["id"] not in infos)

    # 时间轴：等价于播放器 buildSlots（group 重叠、取最大值）
    timeline = []  # (uid, start_ms, dur_ms, frames)
    acc_ms = 0.0
    i = 0
    n = len(text_units)
    while i < n:
        u = text_units[i]
        g = u.get("group")
        grp = [u]
        j = i
        if g is not None:
            while j + 1 < n and text_units[j + 1].get("group") == g:
                j += 1
                grp.append(text_units[j])
        slot_ms = max(_dur_of_uid(infos, audio_map, x["id"]) for x in grp)
        for x in grp:
            d = _dur_of_uid(infos, audio_map, x["id"])
            timeline.append((x["id"], acc_ms, d, infos.get(x["id"], (None, None))[1]))
        acc_ms += slot_ms
        i = j + 1

    total_ms = acc_ms
    total_frames = int(round(total_ms / 1000 * rate))
    buf = array.array("h", bytes(2 * total_frames))

    prev_off = None
    for uid, start_ms, _dur, frames in timeline:
        if not frames:
            prev_off = None
            continue
        arr = array.array("h")
        arr.frombytes(frames)
        off = int(round(start_ms / 1000 * rate))
        n = len(arr)
        if off < 0:
            off = 0
        end = off + n
        if end > total_frames:
            n = max(0, total_frames - off)
        if n <= 0:
            prev_off = None
            continue
        # 重叠（同 group 同时说话）才需要逐采样混合；否则直接切片拷贝
        if prev_off is not None and off == prev_off:
            for k in range(n):
                idx = off + k
                s = buf[idx] + arr[k]
                if s > 32767:
                    s = 32767
                elif s < -32768:
                    s = -32768
                buf[idx] = s
        else:
            buf[off:off + n] = arr[:n]
        prev_off = off

    out_path = full_audio_path(base, sid, eid)
    with wave.open(out_path, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(sampwidth)
        w.setframerate(rate)
        w.writeframes(buf.tobytes())

    return {
        "durationMs": int(round(total_ms)),
        "units": len(text_units),
        "missing": missing,
        "path": out_path,
    }


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
            if self.path.startswith("/check-dir"):
                base = self._base(q)
                path = os.path.abspath(os.path.expanduser(base))
                self._json({
                    "ok": os.path.isdir(path) or os.path.isdir(os.path.dirname(path)),
                    "isDir": os.path.isdir(path),
                    "parentOk": os.path.isdir(os.path.dirname(path)),
                })
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
                eps = []
                for ep in proj.get("episodes") or []:
                    p = full_audio_path(base, sid, ep.get("id", ""))
                    eps.append({**ep, "full": os.path.isfile(p)})
                self._json({"ok": True, "episodes": eps})
                return
            if self.path.startswith("/full-audio-info"):
                base = self._base(q)
                sid = q.get("series", [""])[0]
                eid = q.get("id", [""])[0]
                path = full_audio_path(base, sid, eid)
                ep_folder = safe_child(base, sid, eid)
                ep_proj = read_json(os.path.join(ep_folder, "project.json")) or {}
                text_units = [u for u in (ep_proj.get("units") or []) if (u.get("text") or "").strip()]
                audio_dir = os.path.join(ep_folder, "audio")
                missing = 0
                newest_mtime = 0
                for u in text_units:
                    p = os.path.join(audio_dir, str(u["id"]) + ".wav")
                    if os.path.isfile(p):
                        m = os.path.getmtime(p)
                        if m > newest_mtime:
                            newest_mtime = m
                    else:
                        missing += 1
                complete = bool(text_units) and missing == 0
                exists = os.path.isfile(path)
                stale = False
                dur = None
                if exists:
                    try:
                        with wave.open(path, "rb") as w:
                            dur = int(round(w.getnframes() / w.getframerate() * 1000))
                    except Exception:
                        pass
                    if complete and newest_mtime:
                        stale = os.path.getmtime(path) < newest_mtime
                self._json({
                    "ok": True,
                    "exists": exists,
                    "path": path if exists else None,
                    "durationMs": dur,
                    "complete": complete,
                    "stale": stale,
                    "missing": missing,
                })
                return
            if self.path.startswith("/full-audio"):
                base = self._base(q)
                sid = q.get("series", [""])[0]
                eid = q.get("id", [""])[0]
                path = full_audio_path(base, sid, eid)
                if not os.path.isfile(path):
                    self.send_error(404)
                    return
                with open(path, "rb") as f:
                    data = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "audio/wav")
                self.send_header("Content-Length", str(len(data)))
                self._cors()
                self.end_headers()
                self.wfile.write(data)
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
            if self.path.startswith("/pick-dir"):
                result = subprocess.run(
                    ["osascript", "-e", 'POSIX path of (choose folder with prompt "选择剧本围读存档目录")'],
                    capture_output=True,
                    text=True,
                    timeout=120,
                )
                if result.returncode != 0:
                    self._json({"ok": False, "canceled": True})
                    return
                self._json({"ok": True, "dir": result.stdout.strip()})
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
            if self.path.startswith("/stitch"):
                body = self._read_json()
                base = body.get("dir", "") or "~/Documents/剧本围读存档"
                sid = str(body.get("series", ""))
                eid = str(body.get("id", ""))
                d = render_stitch(base, sid, eid)
                self._json({"ok": True, **d})
                return
            if self.path.startswith("/reveal"):
                body = self._read_json()
                base = body.get("dir", "") or "~/Documents/剧本围读存档"
                sid = str(body.get("series", ""))
                eid = str(body.get("id", ""))
                path = full_audio_path(base, sid, eid)
                if not os.path.isfile(path):
                    self._json({"ok": False, "error": "完整音频尚未生成"}, 404)
                    return
                subprocess.run(["open", "-R", path], check=False)
                self._json({"ok": True, "path": path})
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
