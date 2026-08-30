import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ArchiveContext, FullAudioState, Project, Unit, UnitAudio, VoiceSpec } from "../lib/types";
import PlayerBar from "../components/PlayerBar";
import { toChineseNumber, roleBase } from "../lib/parser";
import { qwenSynthOne, qwenCloneSynthOne } from "../lib/tts";
import { describeRoleVoice } from "../lib/llm";
import { defaultVoiceDescFor } from "../lib/voices";
import { saveAudio, saveMeta, saveSeed, saveVoiceBank, loadVoiceBank, archiveAudioUrl } from "../lib/archive";
import { loadQwenUrl, loadDsKey, loadAiEnabled, loadSource } from "../lib/settings";
import { isDark, type Theme } from "../lib/theme";
import { slugify } from "../lib/series";

const MAX_SIMUL = 3;

async function blobToB64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  }
  return btoa(binary);
}

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

export default function PlayerPage({ theme, onTheme, project, items, synthDone, initialIndex = -1, initialMs = 0, initialRate = 1, onBack, onPosition, onUpdateItems, fullState, onReveal, onGenerate, onExportAfterRegen, voiceMapRef, regenClaimedRef, regenInProgressRef }: {
  theme: Theme;
  onTheme: (t: Theme) => void;
  project: Project;
  items: UnitAudio[];
  synthDone: boolean;
  initialIndex?: number;
  initialMs?: number;
  initialRate?: number;
  onBack: () => void;
  onPosition?: (currentIdx: number, globalMs: number, rate: number) => void;
  onUpdateItems?: (updates: Record<number, { url: string; durationMs: number }>) => void;
  fullState?: FullAudioState;
  onReveal?: () => void;
  onGenerate?: () => void;
  onExportAfterRegen?: (ctx: ArchiveContext) => void;
  voiceMapRef: { current: Record<string, VoiceSpec> };
  regenClaimedRef: { current: Map<number, { url: string; durationMs: number }> };
  regenInProgressRef: { current: boolean };
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
  const toggleRef = useRef<() => void>(() => {});
  const rateRef = useRef(initialRate);
  const lastPosRef = useRef(0);
  const posRef = useRef(initialMs);
  const curBlobsRef = useRef<Set<string>>(new Set());
  const synthDoneRef = useRef(synthDone);
  synthDoneRef.current = synthDone;
  const regenAudioRef = useRef<HTMLAudioElement | null>(null);
  const [regenRole, setRegenRole] = useState("");
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenDesc, setRegenDesc] = useState("");
  const [regenSample, setRegenSample] = useState("");
  const [regenBusy, setRegenBusy] = useState(false);
  const [regenProgress, setRegenProgress] = useState<{ done: number; total: number } | null>(null);
  const [regenErr, setRegenErr] = useState("");

  const qwenUrl = loadQwenUrl();
  const dsKey = loadDsKey();
  const aiEnabled = loadAiEnabled();
  const source = loadSource();
  const roleNames = useMemo(
    () => Array.from(new Set(project.units.filter((u) => u.type === "dialogue").map((u) => u.character).filter(Boolean))),
    [project]
  );

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
  const playableCount = useMemo(() => items.filter((it) => it.url && it.durationMs > 0).length, [items]);
  const synthPct = totalUnits ? Math.min(100, Math.round((playableCount / totalUnits) * 100)) : 0;
  const allComplete = synthDone && playableCount >= totalUnits;

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { saveNow(); onBack(); }
      if (e.code === "Space") {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
        e.preventDefault();
        toggleRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

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
  toggleRef.current = toggle;

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

  const nearestDialogue = (role: string) => {
    const roleUnits = project.units.filter((u) => u.type === "dialogue" && u.character === role);
    if (!roleUnits.length) return "夜色渐深，街角的咖啡店还亮着灯。";
    const curId = activeUnitIds[0] ?? roleUnits[0].id;
    return roleUnits.reduce((a, b) => (Math.abs(a.id - curId) <= Math.abs(b.id - curId) ? a : b)).text;
  };

  const openRegen = () => {
    const role = regenRole;
    if (!role) return;
    const cv = project.voices.find((v) => v.name === role);
    setRegenDesc(cv?.voiceDesc || defaultVoiceDescFor({ name: role, gender: cv?.gender, age: cv?.age }));
    setRegenSample(nearestDialogue(role));
    setRegenErr("");
    setRegenProgress(null);
    setRegenOpen(true);
  };

  const aiDesc = async () => {
    if (!dsKey.trim()) { setRegenErr("未配置 DeepSeek Key"); return; }
    setRegenBusy(true);
    setRegenErr("");
    try {
      const d = await describeRoleVoice(dsKey.trim(), { name: regenRole }, [regenSample]);
      setRegenDesc(d);
    } catch {
      setRegenErr("AI 生成描述失败");
    } finally {
      setRegenBusy(false);
    }
  };

  const previewSeed = async () => {
    if (!regenDesc.trim()) { setRegenErr("请先填写声音描述"); return; }
    setRegenBusy(true);
    setRegenErr("");
    try {
      const r = await qwenSynthOne(qwenUrl, regenSample, regenDesc.trim());
      const a = regenAudioRef.current;
      if (a) {
        if (a.src.startsWith("blob:")) URL.revokeObjectURL(a.src);
        a.src = URL.createObjectURL(r.blob);
        a.play().catch(() => {});
      }
    } catch (e) {
      setRegenErr("试听失败：" + String(e));
    } finally {
      setRegenBusy(false);
    }
  };

  const applyRegen = async () => {
    if (!regenRole || !regenDesc.trim()) { setRegenErr("请先填写声音描述"); return; }
    setRegenBusy(true);
    setRegenErr("");
    regenInProgressRef.current = true;
    try {
      const refText = regenSample;
      const seed = await qwenSynthOne(qwenUrl, refText, regenDesc.trim());
      const b64 = await blobToB64(seed.blob);
      voiceMapRef.current[regenRole] = { kind: "clone", b64, refText };
      const curUnitId = activeUnitIds[0] ?? -1;
      const roleUnits = project.units
        .filter((u) => u.type === "dialogue" && u.character === regenRole)
        .sort((a, b) => a.id - b.id);
      const behind = roleUnits.filter((u) => u.id > curUnitId);
      const ahead = roleUnits.filter((u) => u.id <= curUnitId);
      const ordered = [...behind, ...ahead];
      const updates: Record<number, { url: string; durationMs: number }> = {};
      const durations: Record<number, { durationMs: number }> = {};
      const ar = project.archive;
      let cursor = 0;
      const worker = async () => {
        while (true) {
          const idx = cursor++;
          if (idx >= ordered.length) break;
          const u = ordered[idx];
          const r = await qwenCloneSynthOne(qwenUrl, u.text, b64, refText);
          let url: string;
          if (ar) {
            await saveAudio(ar.dir, ar.series, ar.episode, u.id, r.blob);
            url = archiveAudioUrl(ar.dir, ar.series, ar.episode, u.id);
            durations[u.id] = { durationMs: r.durationMs };
            regenClaimedRef.current.set(u.id, { url, durationMs: r.durationMs });
          } else {
            url = URL.createObjectURL(r.blob);
          }
          updates[u.id] = { url, durationMs: r.durationMs };
          onUpdateItems?.({ [u.id]: updates[u.id] });
          const doneCount = Object.keys(updates).length;
          setRegenProgress({ done: doneCount, total: ordered.length });
          if (doneCount === 5) setRegenOpen(false);
        }
      };
      await Promise.all([worker(), worker()]);
      if (ar) {
        await saveMeta(ar.dir, ar.series, ar.episode, { id: ar.episode, name: ar.episodeName, source: "qwen", audio: durations });
        // 把新种子写回音色库/种子文件/项目 voices，后续补缺与跨集都用新音色
        const roleKey = roleBase(regenRole);
        await saveSeed(ar.dir, ar.series, roleKey, seed.blob);
        const bank = await loadVoiceBank(ar.dir, ar.series);
        bank.roles[roleKey] = {
          ...(bank.roles[roleKey] || {}),
          canonical: roleKey,
          source: "qwen",
          voiceDesc: regenDesc.trim(),
          seed: "seeds/" + slugify(roleKey) + ".wav",
          refText,
          confirmedIn: ar.episodeName
        };
        await saveVoiceBank(ar.dir, ar.series, bank);
        await saveMeta(ar.dir, ar.series, ar.episode, {
          voices: project.voices.map((v) =>
            v.name === regenRole
              ? { ...v, voiceDesc: regenDesc.trim(), cloneAudioB64: b64, cloneRefText: refText }
              : v
          )
        });
        regenInProgressRef.current = false;
        // 只在整集已完整合成（每个对白都有音频）时才自动重拼，避免中间态误报“生成失败”
        if (items.length === totalUnits && items.every((it) => it.url && it.durationMs > 0)) {
          onExportAfterRegen?.(ar);
        }
      }
      setRegenProgress(null);
      setRegenOpen(false);
    } catch (e) {
      setRegenErr("重新生成失败：" + String(e));
    } finally {
      regenInProgressRef.current = false;
      setRegenBusy(false);
    }
  };

  return (
    <div className="player-page">
      <div style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
        {Array.from({ length: MAX_SIMUL }).map((_, k) => <audio key={k} ref={setAudioRef(k)} preload="auto" />)}
      </div>
      <header className="topbar">
        <button onClick={() => { saveNow(); onBack(); }} className="tb-btn">← 返回</button>
        <div className="tb-right">
          <button
            className={"ios-switch" + (isDark(theme) ? " on" : "")}
            onClick={() => onTheme(isDark(theme) ? "light" : "dark")}
            aria-label={isDark(theme) ? "切换到浅色" : "切换到深色"}
            title={isDark(theme) ? "切换到浅色" : "切换到深色"}
          />
          {source === "qwen" && (
            <div className="tb-regen">
              <select value={regenRole} onChange={(e) => setRegenRole(e.target.value)} title="选择角色">
                <option value="">角色音色</option>
                {roleNames.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <button className="tb-btn" disabled={!regenRole} onClick={openRegen}>重生成</button>
            </div>
          )}
          <div className="tb-meta">
            {(() => {
              const label =
                fullState === "done" ? "整集音频已生成"
                : fullState === "stitching" ? "正在生成整集音频…"
                : fullState === "failed" ? "整集音频生成失败"
                : fullState === "generate" ? "可生成整集音频"
                : "";
              const action =
                fullState === "done" ? onReveal
                : fullState === "generate" || fullState === "failed" ? onGenerate
                : undefined;
              if (label) {
                return (
                  <button
                    className={"tb-info export-btn " + fullState}
                    onClick={action}
                    disabled={!action}
                    title={
                      fullState === "done" ? "在访达中显示完整音频"
                      : fullState === "generate" ? "生成整集完整音频"
                      : fullState === "failed" ? "重新生成整集完整音频"
                      : undefined
                    }
                  >
                    {label}
                  </button>
                );
              }
              return (
                <span className="tb-info">
                  {allComplete
                    ? "已全部合成"
                    : synthDone
                      ? "未全部合成 · 已合成 " + playableCount + "/" + totalUnits + " 句"
                      : "后台合成中 · 已合成 " + playableCount + " 句"}
                </span>
              );
            })()}
            {playableCount < totalUnits && (
              <div className="tb-progress">
                <div className="tb-progress-fill" style={{ width: synthPct + "%" }} />
              </div>
            )}
          </div>
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
      {regenOpen && (
        <div className="modal-mask" onClick={() => setRegenOpen(false)}>
          <div className="modal settings-modal regen-modal" onClick={(e) => e.stopPropagation()}>
            <header className="lib-top">
              <span className="lib-title">重新生成音色 · {regenRole || ""}</span>
              <button className="lib-close" disabled={regenBusy} onClick={() => setRegenOpen(false)} aria-label="关闭">✕</button>
            </header>
            <div className="regen-body">
              <label className="regen-label">声音描述</label>
              <textarea
                className="design-desc"
                rows={3}
                value={regenDesc}
                onChange={(e) => setRegenDesc(e.target.value)}
              />
              <div className="regen-actions">
                <button className="secondary-pill" disabled={regenBusy} onClick={aiDesc}>AI 生成描述</button>
                <button className="secondary-pill" disabled={regenBusy} onClick={previewSeed}>试听</button>
                <button className="primary" disabled={regenBusy} onClick={applyRegen}>生成并应用</button>
              </div>
              {regenProgress && <div className="prog">正在重新合成… {regenProgress.done}/{regenProgress.total}</div>}
              {regenErr && <div className="err">{regenErr}</div>}
              <p className="regen-hint">优先生成当前位置之后该角色的台词，生成五句后自动收起，其余在后台继续。</p>
            </div>
            <audio ref={regenAudioRef} />
          </div>
        </div>
      )}
    </div>
  );
}
