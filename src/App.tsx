import { useCallback, useState } from "react";
import type { Project, Session, UnitAudio } from "./lib/types";
import HomePage from "./pages/HomePage";
import OnboardingPage from "./pages/OnboardingPage";
import UploadPage from "./pages/UploadPage";
import PlayerPage from "./pages/PlayerPage";
import { hasOnboarded, markOnboarded, saveDsKey, saveSource, type TtsSource } from "./lib/settings";

export default function App() {
  const [view, setView] = useState<"home" | "onboard" | "work" | "player">("home");
  const [project, setProject] = useState<Project | null>(null);
  const [items, setItems] = useState<UnitAudio[]>([]);
  const [synthDone, setSynthDone] = useState(false);
  const [lastSession, setLastSession] = useState<Session | null>(null);

  const registerUnit = useCallback((item: UnitAudio) => {
    setItems((prev) => [...prev, item]);
  }, []);

  const resetItems = useCallback(() => {
    setItems([]);
    setSynthDone(false);
  }, []);

  const markSynthDone = useCallback(() => setSynthDone(true), []);

  const enter = () => setView(hasOnboarded() ? "work" : "onboard");

  const finishOnboard = (source: TtsSource, dsKey: string) => {
    markOnboarded();
    saveSource(source);
    saveDsKey(dsKey);
    setView("work");
  };

  return (
    <div className="app">
      {view === "home" && <HomePage onEnter={enter} />}
      {view === "onboard" && <OnboardingPage onDone={finishOnboard} />}
      {view === "work" && (
        <UploadPage
          lastSession={lastSession}
          onAnalyzed={setLastSession}
          resetItems={resetItems}
          registerUnit={registerUnit}
          markSynthDone={markSynthDone}
          setProject={setProject}
          onEnterPlayer={() => setView("player")}
        />
      )}
      {view === "player" && (
        project && (
          <PlayerPage
            project={project}
            items={items}
            synthDone={synthDone}
            onBack={() => setView("work")}
          />
        )
      )}
    </div>
  );
}
