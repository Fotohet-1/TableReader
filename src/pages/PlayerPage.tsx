import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Project, Unit, UnitAudio } from "../lib/types";
import PlayerBar from "../components/PlayerBar";
import { toChineseNumber } from "../lib/parser";

const MAX_SIMUL = 3;

interface Slot {
  items: UnitAudio[];
  unitIds: number[];
  startMs: number;
  endMs: number;
  durationMs: number;
}

function buildSlots(items: UnitAudio[], groupByUnit: Map<number, number>): Slot[] {
  const slots: Slot[] = [];
  let acc = 0;
  let i = 0;
  while (i < items.length) {
    const it = items[i];
    const g = groupByUnit.get(it.unitId);
    let j = i;
    const group = [it];
    if (g != null) {
      while (j + 1 < items.length && groupByUnit.get(items[j + 1].unitId) === g) {
        j++;
        group.push(items[j]);
      }
    }
    const duration = group.reduce((m, x) => Math.max(m, x.durationMs), 0);
    const startMs = acc;
    acc += duration;
    slots.push({ items: group, unitIds: group.map((x) => x.unitId), startMs, endMs: acc, durationMs: duration });
    i = j + 1;
  }
  return slots;
}

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

function retryPlay(a: HTMLAudioElement) {
  const p = a.play();
  if (p) {
    p.catch((e) => {
      (window as unknown as Record<string, unknown>).__playErr = e && e.name ? e.name + ": " + e.message : String(e);
      let tries = 0;
      const retry = () => {
        tries++;
        const p2 = a.play();
        if (p2) p2.catch(() => { if (tries < 4) setTimeout(retry, 150); });
      };
      setTimeout(retry, 100);
    });
  }
}

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
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const audioElsRef = useRef<(HTMLAudioElement | null)[]>([]);
  const masterElRef = useRef<HTMLAudioElement | null>(null);
  const [slotIdx, setSlotIdx] = useState(initialIndex >= 0 ? initialIndex : 0);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [rate, setRate] = useState(initialRate);
  const [globalMs, setGlobalMs] = useState(initialMs);
  const followLockUntil = useRef(0);
  const jumpMode = useRef(false);
  const slotIdxRef = useRef(-1);
  const rateRef = useRef(initialRate);
  const lastPosRef = useRef(0);
  const posRef = useRef(initialMs);
  const curBlobsRef = useRef<Set<string>>(new Set());
  const synthDoneRef = useRef(synthDone);
  synthDoneRef.current = synthDone;

  const groupByUnit = useMemo(() => {
    const m = new Map<number, number>();
    for (const u of project.units) if (u.group != null) m.set(u.id, u.group);
    return m;
  }, [project]);

  const slots = useMemo(() => buildSlots(items, groupByUnit), [items, groupByUnit]);
  const slotsRef = useRef(slots);
  slotsRef.current = slots;

  const totalMs = slots.length ? slots[slots.length - 1].endMs : 0;
  const hasPlayable = slots.some((s) => s.items.some((x) => x.url && x.durationMs > 0));
  const activeUnitIds = slotIdx >= 0 && slots[slotIdx] ? slots[slotIdx].unitIds : [];
  const activeUnitId = activeUnitIds[0] ?? null;
  const totalUnits = useMemo(() => project.units.filter((u) => u.text.trim()).length, [project]);
  const synthPct = totalUnits ? Math.min(100, Math.round((items.length / totalUnits) * 100)) : 0;

  const setAudioRef = useCallback((k: number) => (el: HTMLAudioElement | null) => {
    audioElsRef.current[k] = el;
  }, []);

  const playFromSlot = useCallback((si: number, atMs = 0) => {
    const ss = slotsRef.current;
    if (si < 0 || si >= ss.length) return false;
    const slot = ss[si];
    const playable = slot.items.filter((x) => x.url && x.durationMs > 0);
    if (!playable.length) return false;
    slotIdxRef.current = si;
    setSlotIdx(si);
    setWaiting(false);

    const prev = curBlobsRef.current;
    const next = new Set<string>();
    let master: HTMLAudioElement | null = null;
    let masterDur = -1;
    playable.forEach((it, k) => {
      const a = audioElsRef.current[k];
      if (!a) return;
      if (prev.has(it.url)) prev.delete(it.url);
      if (it.url.startsWith("blob:")) next.add(it.url);
      a.src = it.url;
      a.load();
      a.currentTime = Math.min(atMs / 1000, it.durationMs / 1000);
      a.playbackRate = rateRef.current;
      if (it.durationMs > masterDur) { masterDur = it.durationMs; master = a; }
    });
    for (let k = playable.length; k < MAX_SIMUL; k++) {
      const a = audioElsRef.current[k];
      if (a) { a.pause(); a.removeAttribute("src"); a.load(); }
    }
    for (const u of prev) { try { URL.revokeObjectURL(u); } catch {} }
    curBlobsRef.current = next;
    masterElRef.current = master;
    playable.forEach((it, k) => {
      const a = audioElsRef.current[k];
      if (a) retryPlay(a);
    });
    setPlaying(true);
    return true;
  }, []);

  const advance = useCallback(() => {
    const ss = slotsRef.current;
    let i = slotIdxRef.current + 1;
    while (i < ss.length && !ss[i].items.some((x) => x.url && x.durationMs > 0)) i++;
    if (i < ss.length) playFromSlot(i);
    else if (!synthDoneRef.current) setWaiting(true);
  }, [playFromSlot]);
  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  useEffect(() => {
    const els = audioElsRef.current;
    const onEnded = (i: number) => () => {
      if (audioElsRef.current?.[i] === masterElRef.current) {
        setPlaying(false);
        advanceRef.current();
      }
    };
    const onPause = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    const onTime = (i: number) => () => {
      if (audioElsRef.current?.[i] !== masterElRef.current) return;
      const a = audioElsRef.current[i];
      if (!a) return;
      const slot = slotsRef.current[slotIdxRef.current];
      if (!slot) return;
      const ms = slot.startMs + a.currentTime * 1000;
      setGlobalMs(ms);
      posRef.current = ms;
      if (onPosition && ms - lastPosRef.current > 2000) {
        lastPosRef.current = ms;
        onPosition(slotIdxRef.current, Math.round(ms), rateRef.current);
      }
    };
    els.forEach((a, i) => {
      if (!a) return;
      a.addEventListener("ended", onEnded(i));
      a.addEventListener("pause", onPause);
      a.addEventListener("play", onPlay);
      a.addEventListener("timeupdate", onTime(i));
    });
    return () => {
      els.forEach((a, i) => {
        if (!a) return;
        a.removeEventListener("ended", onEnded(i));
        a.removeEventListener("pause", onPause);
        a.removeEventListener("play", onPlay);
        a.removeEventListener("timeupdate", onTime(i));
      });
    };
  }, [onPosition]);

  useEffect(() => {
    const ss = slotsRef.current;
    let i = initialIndex >= 0 ? initialIndex : 0;
    while (i < ss.length && !ss[i].items.some((x) => x.url && x.durationMs > 0)) i++;
    if (i < ss.length) {
      slotIdxRef.current = i;
      setSlotIdx(i);
      const slot = ss[i];
      let master: HTMLAudioElement | null = null;
      let masterDur = -1;
      const offset = initialMs > slot.startMs ? (initialMs - slot.startMs) / 1000 : 0;
      slot.items.filter((x) => x.url && x.durationMs > 0).forEach((it, k) => {
        const a = audioElsRef.current[k];
        if (!a) return;
        a.preload = "auto";
        a.src = it.url;
        a.load();
        a.currentTime = Math.min(offset, it.durationMs / 1000);
        a.playbackRate = rateRef.current;
        if (it.url.startsWith("blob:")) curBlobsRef.current.add(it.url);
        if (it.durationMs > masterDur) { masterDur = it.durationMs; master = a; }
      });
      masterElRef.current = master;
      setGlobalMs(slot.startMs + Math.max(0, initialMs - slot.startMs));
    }
  }, [initialIndex, initialMs]);

  useEffect(() => {
    if (waiting && slots.length > slotIdxRef.current + 1) advanceRef.current();
  }, [slots.length, waiting]);

  const toggle = () => {
    const els = audioElsRef.current;
    const anyPlaying = els.some((a) => a && a.src && !a.paused);
    if (anyPlaying) {
      els.forEach((a) => a && a.pause());
      setPlaying(false);
      return;
    }
    const anySrc = els.some((a) => a && a.src);
    if (anySrc) {
      els.forEach((a) => { if (a && a.src) retryPlay(a); });
      setPlaying(true);
    } else if (slotIdxRef.current >= 0) {
      playFromSlot(slotIdxRef.current);
    }
  };

  const seekTo = (ms: number) => {
    const ss = slotsRef.current;
    if (!ss.length) return;
    const t = Math.max(0, Math.min(ms, ss[ss.length - 1].endMs));
    let si = 0;
    for (let i = 0; i < ss.length; i++) {
      if (t < ss[i].endMs) { si = i; break; }
      si = i;
    }
    jumpMode.current = true;
    playFromSlot(si, t - ss[si].startMs);
  };

  useEffect(() => () => {
    for (const u of curBlobsRef.current) { try { URL.revokeObjectURL(u); } catch {} }
    curBlobsRef.current = new Set();
  }, []);

  const jump = (sec: number) => seekTo(globalMs + sec * 1000);

  const setPlaybackRate = (r: number) => {
    setRate(r);
    rateRef.current = r;
    audioElsRef.current.forEach((a) => { if (a) a.playbackRate = r; });
  };

  useEffect(() => {
    if (activeUnitId == null || slotIdxRef.current === -1) return;
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

  const saveNow = () => {
    const slot = slotsRef.current[slotIdxRef.current];
    const master = masterElRef.current;
    const ms = slot && master ? slot.startMs + master.currentTime * 1000 : posRef.current;
    if (onPosition && slotIdxRef.current >= 0) onPosition(slotIdxRef.current, Math.round(ms), rateRef.current);
  };

  return (
    <div className="player-page">
      <div style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
        {Array.from({ length: MAX_SIMUL }).map((_, k) => <audio key={k} ref={setAudioRef(k)} preload="auto" />)}
      </div>
      <header className="topbar">
        <button onClick={() => { saveNow(); onBack(); }} className="tb-btn">← 返回</button>
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
          <div className="player-empty">
            {project.units.length === 0
              ? "这个存档缺少剧本数据，可能来自旧版本，请返回后重新上传或选择其他存档"
              : "没有可播放的音频，合成可能失败，请返回检查服务状态"}
          </div>
        ) : project.units.map((u) => (
          <UnitLine key={u.id} u={u} project={project} isActive={activeUnitIds.includes(u.id)} setLineRef={setLineRef} />
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
