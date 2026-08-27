export function fmtMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ":" + String(r).padStart(2, "0");
}

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

export default function PlayerBar({ playing, globalMs, totalMs, rate, onToggle, onSeek, onJump, onRate }: {
  playing: boolean;
  globalMs: number;
  totalMs: number;
  rate: number;
  onToggle: () => void;
  onSeek: (ms: number) => void;
  onJump: (sec: number) => void;
  onRate: (r: number) => void;
}) {
  const pct = totalMs > 0 ? Math.min(100, Math.round((globalMs / totalMs) * 100)) : 0;
  return (
    <div className="player-bar">
      <button onClick={onToggle} className="pb-btn pb-play" aria-label={playing ? "暂停" : "播放"}>
        {playing ? "⏸" : "▶"}
      </button>
      <button onClick={() => onJump(-10)} className="pb-btn">-10s</button>
      <button onClick={() => onJump(-5)} className="pb-btn">-5s</button>
      <input
        type="range"
        className="pb-range"
        min={0}
        max={totalMs || 1}
        value={Math.min(globalMs, totalMs || 1)}
        onChange={(e) => onSeek(Number(e.target.value))}
        style={{ background: "linear-gradient(to right, #0066cc " + pct + "%, rgba(0,0,0,.18) " + pct + "%)" }}
      />
      <span className="pb-time">{fmtMs(globalMs)} / {fmtMs(totalMs)}</span>
      <button onClick={() => onJump(5)} className="pb-btn">+5s</button>
      <button onClick={() => onJump(10)} className="pb-btn">+10s</button>
      <select className="pb-rate" value={rate} onChange={(e) => onRate(Number(e.target.value))}>
        {RATES.map((r) => <option key={r} value={r}>{r}×</option>)}
      </select>
    </div>
  );
}
