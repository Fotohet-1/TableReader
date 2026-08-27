import { useCallback, useRef, useState } from "react";
import type { Project, Session, UnitAudio } from "./lib/types";
import HomePage from "./pages/HomePage";
import OnboardingPage from "./pages/OnboardingPage";
import ChoosePage from "./pages/ChoosePage";
import ArchiveContinuePage from "./pages/ArchiveContinuePage";
import UploadPage from "./pages/UploadPage";
import PlayerPage from "./pages/PlayerPage";
import { archiveAudioUrl, loadMeta, savePlayback } from "./lib/archive";
import { hasOnboarded, markOnboarded, saveDsKey, saveSource, type TtsSource } from "./lib/settings";

export default function App() {
  const [view, setView] = useState<"home" | "onboard" | "choose" | "archive" | "work" | "player">("home");
  const [project, setProject] = useState<Project | null>(null);
  const [items, setItems] = useState<UnitAudio[]>([]);
  const [synthDone, setSynthDone] = useState(false);
  const [lastSession, setLastSession] = useState<Session | null>(null);
  const [playerInit, setPlayerInit] = useState({ idx: -1, ms: 0, rate: 1 });
  const archiveActiveRef = useRef(false);
  const projectRef = useRef<Project | null>(null);
  const playerFromRef = useRef<"work" | "archive">("work");
  projectRef.current = project;

  const registerUnit = useCallback((item: UnitAudio) => {
    setItems((prev) => [...prev, item]);
  }, []);

  const resetItems = useCallback(() => {
    setItems([]);
    setSynthDone(false);
  }, []);

  const markSynthDone = useCallback(() => setSynthDone(true), []);

  const updateItems = useCallback((updates: Record<number, { url: string; durationMs: number }>) => {
    setItems((prev) => prev.map((it) => updates[it.unitId] ? { ...it, ...updates[it.unitId] } : it));
  }, []);

  const enter = () => setView(hasOnboarded() ? "choose" : "onboard");

  const resumeArchive = useCallback(async (dir: string, id: string, name: string) => {
    const meta = await loadMeta(dir, id);
    if (!meta) return false;
    const p: Project = {
      scriptText: meta.scriptText || "",
      units: meta.units || [],
      voices: meta.voices || [],
      archive: { dir, id, name }
    };
    const items: UnitAudio[] = (meta.units || []).map((u) => {
      const audio = meta.audio && meta.audio[u.id];
      return {
        unitId: u.id,
        url: audio ? archiveAudioUrl(dir, id, u.id) : "",
        durationMs: audio ? audio.durationMs : 0,
        startMs: 0,
        endMs: 0
      };
    });
    let acc = 0;
    for (const it of items) {
      it.startMs = acc;
      acc += it.durationMs;
      it.endMs = acc;
    }
    setProject(p);
    setItems(items);
    setSynthDone(true);
    archiveActiveRef.current = true;
    setPlayerInit({
      idx: meta.playback?.currentIdx ?? 0,
      ms: meta.playback?.globalMs ?? 0,
      rate: meta.playback?.rate ?? 1
    });
    playerFromRef.current = "archive";
    setView("player");
    return true;
  }, []);

  const handlePosition = useCallback((idx: number, ms: number, rate: number) => {
    const p = projectRef.current;
    if (!archiveActiveRef.current || !p?.archive) return;
    void savePlayback(p.archive.dir, p.archive.id, idx, ms, rate);
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
          onBack={() => setView("home")}
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
          lastSession={lastSession}
          onAnalyzed={setLastSession}
          resetItems={resetItems}
          registerUnit={registerUnit}
          markSynthDone={markSynthDone}
          setProject={setProject}
          onArchiveNew={() => {
            archiveActiveRef.current = false;
            setPlayerInit({ idx: -1, ms: 0, rate: 1 });
          }}
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
            project={project}
            items={items}
            synthDone={synthDone}
            initialIndex={playerInit.idx}
            initialMs={playerInit.ms}
            initialRate={playerInit.rate}
            onBack={() => setView(playerFromRef.current === "archive" ? "archive" : "work")}
            onPosition={handlePosition}
            onUpdateItems={updateItems}
          />
        )
      )}
    </div>
  );
}
