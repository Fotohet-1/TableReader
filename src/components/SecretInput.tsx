import { useState } from "react";

function maskKey(k: string): string {
  const t = k.trim();
  if (t.length <= 8) return t.slice(0, 2) + "••••" + t.slice(-2);
  return t.slice(0, 4) + "••••••" + t.slice(-4);
}

export default function SecretInput({ value, onChange, placeholder = "可选" }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const has = value.trim().length > 0;

  if (has) {
    return (
      <div className="secret-input">
        <input
          className="secret-text"
          type="text"
          readOnly
          value={revealed ? value : maskKey(value)}
          onFocus={(e) => e.currentTarget.select()}
          title={revealed ? "已显示" : "已隐藏，点右侧查看"}
          spellCheck={false}
          autoComplete="off"
        />
        <button type="button" className="secret-btn" onClick={() => setRevealed((r) => !r)}>
          {revealed ? "隐藏" : "显示"}
        </button>
        <button type="button" className="secret-btn" onClick={() => { setRevealed(false); onChange(""); }}>
          清除
        </button>
      </div>
    );
  }

  return (
    <div className="secret-input">
      <input
        className="secret-field"
        type={revealed ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
      />
      <button type="button" className="secret-btn" onClick={() => setRevealed((r) => !r)}>
        {revealed ? "隐藏" : "显示"}
      </button>
    </div>
  );
}
