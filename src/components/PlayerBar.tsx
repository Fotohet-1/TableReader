import { useEffect, useRef, useState, type CSSProperties } from "react";

export function fmtMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ":" + String(r).padStart(2, "0");
}

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

function TimeCode({ ms, length }: { ms: number; length: number }) {
  const label = fmtMs(ms).padStart(length, "0");
  return (
    <span className="pb-time-code" aria-label={label}>
      {label.split("").map((char, index) => (
        <span key={index} aria-hidden="true">{char}</span>
      ))}
    </span>
  );
}

export default function PlayerBar({ playing, globalMs, totalMs, rate, getLiveMs, onToggle, onSeek, onJump, onRate }: {
  playing: boolean;
  globalMs: number;
  totalMs: number;
  rate: number;
  getLiveMs: () => number;
  onToggle: () => void;
  onSeek: (ms: number) => void;
  onJump: (sec: number) => void;
  onRate: (r: number) => void;
}) {
  const [displayMs, setDisplayMs] = useState(globalMs);
  const frameRef = useRef(0);
  const totalLabel = fmtMs(totalMs);
  const progress = totalMs > 0 ? Math.max(0, Math.min(1, displayMs / totalMs)) : 0;

  useEffect(() => {
    const syncLive = () => {
      const next = totalMs > 0 ? Math.min(totalMs, Math.max(0, getLiveMs())) : 0;
      setDisplayMs(next);
    };
    if (!playing) {
      syncLive();
      return;
    }
    const tick = () => {
      syncLive();
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [playing, totalMs, getLiveMs]);

  return (
    <div className="player-bar">
      <button onClick={onToggle} className="pb-btn pb-play" aria-label={playing ? "暂停" : "播放"}>
        {playing ? "⏸" : "▶"}
      </button>
      <button onClick={() => onJump(-10)} className="pb-btn">-10s</button>
      <button onClick={() => onJump(-5)} className="pb-btn">-5s</button>
      <div className="pb-slider" style={{ "--pb-progress": progress } as CSSProperties}>
        <div className="pb-track" aria-hidden="true">
          <div className="pb-fill" />
        </div>
        <input
          type="range"
          className="pb-range"
          min={0}
          max={totalMs || 1}
          value={Math.min(displayMs, totalMs || 1)}
          onChange={(e) => onSeek(Number(e.target.value))}
        />
      </div>
      <span className="pb-time">
        <TimeCode ms={displayMs} length={totalLabel.length} />
        <span className="pb-time-sep">/</span>
        <TimeCode ms={totalMs} length={totalLabel.length} />
      </span>
      <button onClick={() => onJump(5)} className="pb-btn">+5s</button>
      <button onClick={() => onJump(10)} className="pb-btn">+10s</button>
      <select className="pb-rate" value={rate} onChange={(e) => onRate(Number(e.target.value))}>
        {RATES.map((r) => <option key={r} value={r}>{r}×</option>)}
      </select>
    </div>
  );
}
