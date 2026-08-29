import { useCallback, useEffect, useRef, useState } from "react";
import type { Project, Session, UnitAudio } from "./lib/types";
import HomePage from "./pages/HomePage";
import OnboardingPage from "./pages/OnboardingPage";
import ChoosePage from "./pages/ChoosePage";
import ArchiveContinuePage from "./pages/ArchiveContinuePage";
import UploadPage from "./pages/UploadPage";
import PlayerPage from "./pages/PlayerPage";
import { archiveAudioUrl, loadMeta, saveMeta, savePlayback, stitchAudio, revealFullAudio, fullAudioInfo } from "./lib/archive";
import type { ArchiveContext, FullAudioState } from "./lib/types";
import { hasOnboarded, markOnboarded, saveDsKey, saveSource, loadEdgeUrl, loadQwenUrl, loadSource, type TtsSource } from "./lib/settings";
import { loadTheme, saveTheme, applyTheme, subscribeSystem, type Theme } from "./lib/theme";
import { continueSynthesis } from "./lib/resume";
import { checkHealth } from "./lib/tts";

export default function App() {
  const [view, setView] = useState<"home" | "onboard" | "choose" | "archive" | "work" | "player">("home");
  const [project, setProject] = useState<Project | null>(null);
  const [items, setItems] = useState<UnitAudio[]>([]);
  const [synthDone, setSynthDone] = useState(false);
  const [lastSession, setLastSession] = useState<Session | null>(null);
  const [playerInit, setPlayerInit] = useState({ idx: -1, ms: 0, rate: 1 });
  const archiveActiveRef = useRef(false);
  const [fullState, setFullState] = useState<FullAudioState>("unknown");
  const fullTargetRef = useRef<ArchiveContext | null>(null);
  const resumeTokenRef = useRef(0);
  const projectRef = useRef<Project | null>(null);
  const playerFromRef = useRef<"work" | "archive">("work");
  projectRef.current = project;

  const [theme, setThemeState] = useState<Theme>(loadTheme);
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    return subscribeSystem(() => applyTheme("system"));
  }, [theme]);
  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    saveTheme(t);
  }, []);

  const registerUnit = useCallback((item: UnitAudio) => {
    setItems((prev) => [...prev, item]);
  }, []);

  const resetItems = useCallback(() => {
    setItems((prev) => {
      for (const it of prev) {
        if (it.url && it.url.startsWith("blob:")) {
          try { URL.revokeObjectURL(it.url); } catch {}
        }
      }
      return [];
    });
    setSynthDone(false);
  }, []);

  const markSynthDone = useCallback(() => setSynthDone(true), []);

  const runStitch = useCallback(async () => {
    const t = fullTargetRef.current;
    if (!t) return;
    setFullState("stitching");
    const res = await stitchAudio(t.dir, t.series, t.episode);
    setFullState(res && res.ok && res.missing === 0 ? "done" : "failed");
  }, []);

  const handleFullReady = useCallback((ctx: ArchiveContext) => {
    fullTargetRef.current = ctx;
    void runStitch();
  }, [runStitch]);

  const handleGenerateFull = useCallback(() => {
    void runStitch();
  }, [runStitch]);

  const handleRevealFull = useCallback(async () => {
    const t = fullTargetRef.current;
    if (t) await revealFullAudio(t.dir, t.series, t.episode);
  }, []);

  const handleAfterRegen = useCallback((ctx: ArchiveContext) => {
    fullTargetRef.current = ctx;
    void runStitch();
  }, [runStitch]);

  const updateItems = useCallback((updates: Record<number, { url: string; durationMs: number }>) => {
    setItems((prev) => prev.map((it) => {
      const upd = updates[it.unitId];
      if (!upd) return it;
      if (it.url && it.url !== upd.url && it.url.startsWith("blob:")) {
        try { URL.revokeObjectURL(it.url); } catch {}
      }
      return { ...it, ...upd };
    }));
  }, []);

  const enter = () => setView(hasOnboarded() ? "choose" : "onboard");

  const resumeArchive = useCallback(async (ctx: ArchiveContext) => {
    const meta = await loadMeta(ctx.dir, ctx.series, ctx.episode);
    if (!meta) return false;
    const p: Project = {
      scriptText: meta.scriptText || "",
      units: meta.units || [],
      voices: meta.voices || [],
      archive: { ...ctx }
    };
    const items: UnitAudio[] = (meta.units || [])
      .filter((u) => meta.audio && meta.audio[u.id])
      .map((u) => ({
        unitId: u.id,
        url: archiveAudioUrl(ctx.dir, ctx.series, ctx.episode, u.id),
        durationMs: meta.audio[u.id].durationMs,
        startMs: 0,
        endMs: 0
      }));
    setProject(p);
    setItems(items);
    archiveActiveRef.current = true;
    setPlayerInit({
      idx: meta.playback?.currentIdx ?? 0,
      ms: meta.playback?.globalMs ?? 0,
      rate: meta.playback?.rate ?? 1
    });
    playerFromRef.current = "archive";
    setView("player");
    fullTargetRef.current = ctx;
    const textUnits = (meta.units || []).filter((u) => (u.text || "").trim());
    const completeMeta = textUnits.every((u) => meta.audio && meta.audio[u.id]);
    setSynthDone(completeMeta);
    const existingAudio: Record<number, { url: string; durationMs: number }> = {};
    for (const [uid, a] of Object.entries(meta.audio || {})) {
      const n = Number(uid);
      existingAudio[n] = { url: archiveAudioUrl(ctx.dir, ctx.series, ctx.episode, n), durationMs: a.durationMs };
    }
    void (async () => {
      const info = await fullAudioInfo(ctx.dir, ctx.series, ctx.episode);
      const complete = info?.complete !== undefined ? info.complete : completeMeta;
      if (complete) {
        setSynthDone(true);
        if (info?.exists && !info?.stale) setFullState("done");
        else setFullState("generate");
      } else {
        // 未合成完：后台自动补齐缺失对白，补完自动拼整集
        setFullState("unknown");
        const source = meta.source || loadSource();
        const healthUrl = source === "qwen" ? loadQwenUrl() : loadEdgeUrl();
        const up = await checkHealth(healthUrl).catch(() => false);
        if (!up) {
          setSynthDone(true);
          return;
        }
        setSynthDone(false);
        const token = resumeTokenRef.current;
        const resumeAudio: Record<number, { durationMs: number }> = {};
        const stream = continueSynthesis({
          project: p,
          source,
          archiveCtx: ctx,
          edgeUrl: loadEdgeUrl(),
          qwenUrl: loadQwenUrl(),
          existingAudio,
          onUnitReady: (item) => {
            if (resumeTokenRef.current !== token) return;
            resumeAudio[item.unitId] = { durationMs: item.durationMs };
            setItems((prev) => {
              const filtered = prev.filter((it) => it.unitId !== item.unitId);
              const idx = filtered.findIndex((it) => it.unitId > item.unitId);
              const next = [...filtered];
              if (idx >= 0) next.splice(idx, 0, item);
              else next.push(item);
              return next;
            });
          }
        });
        stream.done.then((s) => {
          if (resumeTokenRef.current !== token) return;
          void saveMeta(ctx.dir, ctx.series, ctx.episode, { id: ctx.episode, name: ctx.episodeName, source, audio: resumeAudio });
          markSynthDone();
          if (s.failed === 0) {
            fullTargetRef.current = ctx;
            void runStitch();
          }
        });
      }
    })();
    return true;
  }, [runStitch, markSynthDone]);

  const handlePosition = useCallback((idx: number, ms: number, rate: number) => {
    const p = projectRef.current;
    if (!archiveActiveRef.current || !p?.archive) return;
    void savePlayback(p.archive.dir, p.archive.series, p.archive.episode, idx, ms, rate);
  }, []);

  const finishOnboard = (source: TtsSource, dsKey: string) => {
    markOnboarded();
    saveSource(source);
    saveDsKey(dsKey);
    setView("choose");
  };

  return (
    <div className="app">
      {view === "home" && <HomePage onEnter={enter} />}
      {view === "onboard" && <OnboardingPage onDone={finishOnboard} />}
      {view === "choose" && (
        <ChoosePage
          onUpload={() => setView("work")}
          onContinue={() => setView("archive")}
        />
      )}
      {view === "archive" && (
        <ArchiveContinuePage
          onContinue={resumeArchive}
          onBack={() => setView("choose")}
        />
      )}
      {view === "work" && (
        <UploadPage
          theme={theme}
          onTheme={setTheme}
          lastSession={lastSession}
          onAnalyzed={setLastSession}
          resetItems={resetItems}
          registerUnit={registerUnit}
          markSynthDone={markSynthDone}
          setProject={setProject}
          onArchiveNew={() => {
            archiveActiveRef.current = false;
            resumeTokenRef.current++;
            setFullState("unknown");
            fullTargetRef.current = null;
            setPlayerInit({ idx: -1, ms: 0, rate: 1 });
          }}
          onFullReady={handleFullReady}
          onArchiveActive={() => {
            archiveActiveRef.current = true;
            setPlayerInit({ idx: -1, ms: 0, rate: 1 });
          }}
          onEnterPlayer={() => {
            playerFromRef.current = "work";
            setView("player");
          }}
          onBack={() => setView("choose")}
        />
      )}
      {view === "player" && (
        project && (
          <PlayerPage
            theme={theme}
            onTheme={setTheme}
            project={project}
            items={items}
            synthDone={synthDone}
            initialIndex={playerInit.idx}
            initialMs={playerInit.ms}
            initialRate={playerInit.rate}
            onBack={() => setView(playerFromRef.current === "archive" ? "archive" : "work")}
            onPosition={handlePosition}
            onUpdateItems={updateItems}
            fullState={fullState}
            onReveal={handleRevealFull}
            onGenerate={handleGenerateFull}
            onExportAfterRegen={handleAfterRegen}
          />
        )
      )}
    </div>
  );
}
