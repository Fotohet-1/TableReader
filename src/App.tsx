import { useCallback, useState } from "react";
import type { Project, Session, UnitAudio } from "./lib/types";
import UploadPage from "./pages/UploadPage";
import PlayerPage from "./pages/PlayerPage";

export default function App() {
  const [view, setView] = useState<"work" | "player">("work");
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

  return (
    <div className="app">
      {view === "work" ? (
        <UploadPage
          lastSession={lastSession}
          onAnalyzed={setLastSession}
          resetItems={resetItems}
          registerUnit={registerUnit}
          markSynthDone={markSynthDone}
          setProject={setProject}
          onEnterPlayer={() => setView("player")}
        />
      ) : (
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
