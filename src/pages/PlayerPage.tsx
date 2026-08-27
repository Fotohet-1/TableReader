import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Project, Unit, UnitAudio } from "../lib/types";
import PlayerBar from "../components/PlayerBar";
import { toChineseNumber } from "../lib/parser";

const UnitLine = memo(function UnitLine({ u, project, isActive, setLineRef }: {
  u: Unit;
  project: Project;
  isActive: boolean;
  setLineRef: (id: number) => (el: HTMLDivElement | null) => void;
}) {
  const original = project.scriptText.slice(u.start, u.end);
  if (u.type === "scene") {
    const m = (u.sceneNo || "").match(/\d+/);
    const sceneLabel = (u.episode ? "第" + toChineseNumber(u.episode) + "集 · " : "")
      + (m ? "第" + toChineseNumber(parseInt(m[0], 10)) + "场" : u.sceneNo);
    return (
      <div ref={setLineRef(u.id)} className={"unit unit-scene" + (isActive ? " active" : "")}>
        {sceneLabel && <span className="scene-no">{sceneLabel}</span>}
        {original}
      </div>
    );
  }
  if (u.type === "dialogue") {
    return (
      <div
        ref={setLineRef(u.id)}
        className={"unit unit-dialogue" + (isActive ? " active" : "")}
        style={isActive ? { borderLeftColor: "#0066cc", background: "rgba(0,102,204,.07)" } : { borderLeftColor: "#e0e0e0" }}
      >
        <span className="char-tag">{u.character}</span>
        <span className="char-line">{u.text}</span>
      </div>
    );
  }
  return (
    <div ref={setLineRef(u.id)} className={"unit unit-narration" + (isActive ? " active" : "")}>
      {original}
    </div>
  );
});

export default function PlayerPage({ project, items, synthDone, initialIndex = -1, initialMs = 0, initialRate = 1, onBack, onPosition }: {
  project: Project;
  items: UnitAudio[];
  synthDone: boolean;
  initialIndex?: number;
  initialMs?: number;
  initialRate?: number;
  onBack: () => void;
  onPosition?: (currentIdx: number, globalMs: number, rate: number) => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [currentIdx, setCurrentIdx] = useState(initialIndex);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [rate, setRate] = useState(initialRate);
  const [globalMs, setGlobalMs] = useState(initialMs);
  const followLockUntil = useRef(0);
  const jumpMode = useRef(false);
  const idxRef = useRef(-1);
  const rateRef = useRef(initialRate);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const lastPosRef = useRef(0);
  const posRef = useRef(initialMs);
  const currentBlobRef = useRef("");
  const synthDoneRef = useRef(synthDone);
  synthDoneRef.current = synthDone;

  const itemByUnit = useMemo(() => {
    const m = new Map<number, UnitAudio>();
    for (const it of items) m.set(it.unitId, it);
    return m;
  }, [items]);

  const totalMs = items.length ? items[items.length - 1].endMs : 0;
  const hasPlayable = items.some((i) => i.url && i.durationMs > 0);
  const activeUnitId = currentIdx >= 0 && items[currentIdx] ? items[currentIdx].unitId : null;
  const totalUnits = useMemo(() => project.units.filter((u) => u.text.trim()).length, [project]);
  const synthPct = totalUnits ? Math.min(100, Math.round((items.length / totalUnits) * 100)) : 0;

  const playFrom = (idx: number, atMs = 0) => {
    const audio = audioRef.current;
    const item = itemsRef.current[idx];
    if (!audio || !item || !item.url || item.durationMs <= 0) return false;
    idxRef.current = idx;
    setCurrentIdx(idx);
    setWaiting(false);
    if (currentBlobRef.current && currentBlobRef.current !== item.url) {
      URL.revokeObjectURL(currentBlobRef.current);
      currentBlobRef.current = "";
    }
    audio.src = item.url;
    if (item.url.startsWith("blob:")) currentBlobRef.current = item.url;
    audio.currentTime = atMs / 1000;
    audio.playbackRate = rateRef.current;
    const p = audio.play();
    if (p) {
      p.catch((e) => {
        (window as unknown as Record<string, unknown>).__playErr = e && e.name ? e.name + ": " + e.message : String(e);
        let tries = 0;
        const retry = () => {
          tries++;
          const p2 = audio.play();
          if (p2) p2.catch(() => { if (tries < 4) setTimeout(retry, 150); });
        };
        setTimeout(retry, 100);
      });
    }
    setPlaying(true);
    return true;
  };

  const advance = () => {
    const items2 = itemsRef.current;
    let i = idxRef.current + 1;
    while (i < items2.length && (!items2[i].url || items2[i].durationMs <= 0)) i++;
    if (i < items2.length) playFrom(i);
    else if (!synthDoneRef.current) setWaiting(true);
  };

  useEffect(() => {
    const items2 = itemsRef.current;
    let i = initialIndex >= 0 ? initialIndex : 0;
    while (i < items2.length && (!items2[i].url || items2[i].durationMs <= 0)) i++;
    if (i < items2.length) {
      idxRef.current = i;
      setCurrentIdx(i);
      const audio = audioRef.current;
      if (audio && items2[i].url) {
        audio.preload = "auto";
        audio.src = items2[i].url;
        audio.load();
        audio.currentTime = initialMs > 0 ? Math.min(initialMs / 1000, items2[i].durationMs / 1000) : 0;
        audio.playbackRate = rateRef.current;
        if (items2[i].url.startsWith("blob:")) currentBlobRef.current = items2[i].url;
      }
    }
  }, [initialIndex, initialMs]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnded = () => { setPlaying(false); advance(); };
    const onPause = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    const onTime = () => {
      const item = itemsRef.current[idxRef.current];
      if (!item) return;
      const ms = item.startMs + audio.currentTime * 1000;
      setGlobalMs(ms);
      posRef.current = ms;
      if (onPosition && ms - lastPosRef.current > 2000) {
        lastPosRef.current = ms;
        onPosition(idxRef.current, Math.round(ms), rateRef.current);
      }
    };
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("timeupdate", onTime);
    return () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("timeupdate", onTime);
    };
  }, [onPosition]);

  useEffect(() => {
    return () => {
      const item = itemsRef.current[idxRef.current];
      const ms = item && audioRef.current ? item.startMs + audioRef.current.currentTime * 1000 : posRef.current;
      if (onPosition && idxRef.current >= 0) onPosition(idxRef.current, Math.round(ms), rateRef.current);
    };
  }, [onPosition]);

  useEffect(() => {
    if (waiting && itemsRef.current.length > idxRef.current + 1) advance();
  }, [items.length]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      if (!audio.src && idxRef.current >= 0) playFrom(idxRef.current);
      else {
        setPlaying(true);
        const p = audio.play();
        if (p) {
          p.catch((e) => {
            (window as unknown as Record<string, unknown>).__playErr = e && e.name ? e.name + ": " + e.message : String(e);
            let tries = 0;
            const retry = () => {
              tries++;
              const p2 = audio.play();
              if (p2) p2.catch(() => { if (tries < 4) setTimeout(retry, 150); });
            };
            setTimeout(retry, 100);
          });
        }
      }
    } else audio.pause();
  };

  const seekTo = (ms: number) => {
    const items2 = itemsRef.current;
    if (!items2.length) return;
    const t = Math.max(0, Math.min(ms, items2[items2.length - 1].endMs));
    let idx = 0;
    for (let i = 0; i < items2.length; i++) {
      if (t < items2[i].endMs) { idx = i; break; }
      idx = i;
    }
    const item = items2[idx];
    if (!item || !item.url || item.durationMs <= 0) return;
    jumpMode.current = true;
    playFrom(idx, t - item.startMs);
  };

  useEffect(() => () => {
    if (currentBlobRef.current) URL.revokeObjectURL(currentBlobRef.current);
  }, []);

  const jump = (sec: number) => seekTo(globalMs + sec * 1000);

  const setPlaybackRate = (r: number) => {
    setRate(r);
    rateRef.current = r;
    if (audioRef.current) audioRef.current.playbackRate = r;
  };

  useEffect(() => {
    if (activeUnitId == null || idxRef.current === -1) return;
    const now = performance.now();
    if (now < followLockUntil.current) return;
    const el = lineRefs.current.get(activeUnitId);
    const sc = scrollRef.current;
    if (el && sc) {
      const target = el.offsetTop - sc.clientHeight * 0.32;
      sc.scrollTo({ top: target, behavior: jumpMode.current ? "auto" : "smooth" });
      jumpMode.current = false;
    }
  }, [activeUnitId]);

  const onManualScroll = () => { followLockUntil.current = performance.now() + 4000; };

  const setLineRef = useCallback((id: number) => (el: HTMLDivElement | null) => {
    if (el) lineRefs.current.set(id, el);
    else lineRefs.current.delete(id);
  }, []);

  return (
    <div className="player-page">
      <audio ref={audioRef} preload="auto" />
      <header className="topbar">
        <button onClick={() => {
          const item = itemsRef.current[idxRef.current];
          const ms = item && audioRef.current ? item.startMs + audioRef.current.currentTime * 1000 : posRef.current;
          if (onPosition && idxRef.current >= 0) onPosition(idxRef.current, Math.round(ms), rateRef.current);
          onBack();
        }} className="tb-btn">← 返回</button>
        <div className="tb-meta">
          <span className="tb-info">
            {synthDone ? "已全部合成" : "后台合成中 · 已合成 " + items.length + " 句"}
          </span>
          {!synthDone && (
            <div className="tb-progress">
              <div className="tb-progress-fill" style={{ width: synthPct + "%" }} />
            </div>
          )}
        </div>
      </header>
      <div className="script-scroll" ref={scrollRef} onWheel={onManualScroll} onTouchStart={onManualScroll}>
        {!hasPlayable && synthDone ? (
          <div className="player-empty">没有可播放的音频，合成可能失败，请返回检查服务状态</div>
        ) : project.units.map((u) => (
          <UnitLine key={u.id} u={u} project={project} isActive={u.id === activeUnitId} setLineRef={setLineRef} />
        ))}
      </div>
      {waiting && <div className="wait-banner">正在合成下一句…</div>}
      <PlayerBar
        playing={playing}
        globalMs={globalMs}
        totalMs={totalMs}
        rate={rate}
        onToggle={toggle}
        onSeek={seekTo}
        onJump={jump}
        onRate={setPlaybackRate}
      />
    </div>
  );
}
