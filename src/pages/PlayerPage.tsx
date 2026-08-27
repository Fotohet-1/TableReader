import { useEffect, useMemo, useRef, useState } from "react";
import type { Project, Unit, UnitAudio } from "../lib/types";
import PlayerBar from "../components/PlayerBar";
import { toChineseNumber } from "../lib/parser";

const PALETTE = ["#d1495b", "#3d5a80", "#2a9d8f", "#e07a3f", "#9b5de5", "#f15bb5", "#00bbf9", "#7c3f58"];
const DIALOGUE_RE = /^([\u4e00-\u9fa5A-Za-z0-9·．. ]{1,12})[:：](.*)$/;

function colorFor(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export default function PlayerPage({ project, items, synthDone, onBack }: {
  project: Project;
  items: UnitAudio[];
  synthDone: boolean;
  onBack: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [currentIdx, setCurrentIdx] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [rate, setRate] = useState(1);
  const [globalMs, setGlobalMs] = useState(0);
  const followLockUntil = useRef(0);
  const jumpMode = useRef(false);
  const idxRef = useRef(-1);
  const rateRef = useRef(1);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const synthDoneRef = useRef(synthDone);
  synthDoneRef.current = synthDone;

  const itemByUnit = useMemo(() => {
    const m = new Map<number, UnitAudio>();
    for (const it of items) m.set(it.unitId, it);
    return m;
  }, [items]);

  const totalMs = items.length ? items[items.length - 1].endMs : 0;
  const activeUnitId = currentIdx >= 0 && items[currentIdx] ? items[currentIdx].unitId : null;

  const playFrom = (idx: number, atMs = 0) => {
    const audio = audioRef.current;
    const item = itemsRef.current[idx];
    if (!audio || !item || !item.url || item.durationMs <= 0) return false;
    idxRef.current = idx;
    setCurrentIdx(idx);
    setWaiting(false);
    audio.src = item.url;
    audio.load();
    const start = () => {
      audio.currentTime = atMs / 1000;
      audio.playbackRate = rateRef.current;
      const p = audio.play();
      if (p) {
        p.catch(() => {
          setTimeout(() => { audio.play().catch(() => {}); }, 80);
        });
      }
    };
    if (audio.readyState >= 2) {
      start();
    } else {
      const onReady = () => {
        audio.removeEventListener("loadeddata", onReady);
        start();
      };
      audio.addEventListener("loadeddata", onReady);
      window.setTimeout(() => {
        audio.removeEventListener("loadeddata", onReady);
        if (audio.paused) start();
      }, 800);
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
    let i = 0;
    while (i < items2.length && (!items2[i].url || items2[i].durationMs <= 0)) i++;
    if (i < items2.length) {
      idxRef.current = i;
      setCurrentIdx(i);
    }
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnded = () => { setPlaying(false); advance(); };
    const onPause = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    const onTime = () => {
      const item = itemsRef.current[idxRef.current];
      if (item) setGlobalMs(item.startMs + audio.currentTime * 1000);
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
  }, []);

  useEffect(() => {
    if (waiting && itemsRef.current.length > idxRef.current + 1) advance();
  }, [items.length]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      if (!audio.src && idxRef.current >= 0) playFrom(idxRef.current);
      else audio.play().catch(() => {});
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

  const setLineRef = (id: number) => (el: HTMLDivElement | null) => {
    if (el) lineRefs.current.set(id, el);
    else lineRefs.current.delete(id);
  };

  const renderUnit = (u: Unit) => {
    const isActive = u.id === activeUnitId;
    const original = project.scriptText.slice(u.start, u.end);
    const color = u.type === "dialogue" ? colorFor(u.character) : "#8a8578";
    if (u.type === "scene") {
      const m = (u.sceneNo || "").match(/\d+/);
      const sceneLabel = (u.episode ? "第" + toChineseNumber(u.episode) + "集 · " : "")
        + (m ? "第" + toChineseNumber(parseInt(m[0], 10)) + "场" : u.sceneNo);
      return (
        <div key={u.id} ref={setLineRef(u.id)} className={"unit unit-scene" + (isActive ? " active" : "")}>
          {sceneLabel && <span className="scene-no">{sceneLabel}</span>}
          {original}
        </div>
      );
    }
    if (u.type === "dialogue") {
      const m = original.match(DIALOGUE_RE);
      return (
        <div
          key={u.id}
          ref={setLineRef(u.id)}
          className={"unit unit-dialogue" + (isActive ? " active" : "")}
          style={isActive ? { borderLeftColor: color, background: color + "1f" } : { borderLeftColor: color }}
        >
          {m && <span className="char-tag" style={{ color }}>{m[1]}</span>}
          <span className="char-line">{m ? m[2] : original}</span>
        </div>
      );
    }
    return (
      <div key={u.id} ref={setLineRef(u.id)} className={"unit unit-narration" + (isActive ? " active" : "")}>
        {original}
      </div>
    );
  };

  return (
    <div className="player-page">
      <audio ref={audioRef} preload="auto" />
      <header className="topbar">
        <button onClick={onBack} className="tb-btn">← 返回</button>
        <span className="tb-info">
          {synthDone ? "已全部合成" : "后台合成中 · 已合成 " + items.length + " 句"}
        </span>
      </header>
      <div className="script-scroll" ref={scrollRef} onWheel={onManualScroll} onTouchStart={onManualScroll}>
        {project.units.map(renderUnit)}
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
