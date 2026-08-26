import { useState } from "react";
import { checkDeepSeekKey } from "../lib/llm";
import type { TtsSource } from "../lib/settings";

export default function OnboardingPage({ onDone }: {
  onDone: (source: TtsSource, dsKey: string) => void;
}) {
  const [step, setStep] = useState(0);
  const [source, setSource] = useState<TtsSource | null>(null);
  const [key, setKey] = useState("");
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState("");

  const checkAndContinue = async () => {
    if (!key.trim()) {
      onDone(source || "qwen", "");
      return;
    }
    setChecking(true);
    setErr("");
    const ok = await checkDeepSeekKey(key.trim());
    setChecking(false);
    if (ok) {
      onDone(source || "qwen", key.trim());
    } else {
      setErr("Key 校验失败，可检查后重试，或暂不设置");
    }
  };

  return (
    <div className="onboard">
      {step === 0 && (
        <div className="onboard-inner" onClick={(e) => e.stopPropagation()}>
          <p className="onboard-title">请选择声音来源</p>
          <div className="onboard-cards">
            <div className={"ob-card" + (source === "qwen" ? " on" : "")} onClick={() => setSource("qwen")}>
              <h3>Qwen3 1.7B 本地</h3>
              <p>自然语言描述即可生成角色音色，全本地运行，效果最好</p>
              <span className="ob-tag">需要 Apple Silicon 与模型</span>
            </div>
            <div className={"ob-card" + (source === "edge" ? " on" : "")} onClick={() => setSource("edge")}>
              <h3>edge-tts 在线</h3>
              <p>即开即用，依赖微软在线语音，音色固定但选择多</p>
              <span className="ob-tag">需要联网</span>
            </div>
          </div>
          <button
            className="primary onboard-next"
            disabled={!source}
            onClick={() => setStep(1)}
          >
            继续
          </button>
        </div>
      )}
      {step === 1 && (
        <div className="onboard-inner" onClick={(e) => e.stopPropagation()}>
          <div className="ob-ai-card">
            <p className="onboard-title">AI 加持</p>
            <p className="ob-ai-text">
              借助大模型，程序会更智能地拆解剧本、合并角色，并为每个角色写出符合台词气质的声音描述。
            </p>
            <div className="ob-key-field">
              <label>DeepSeek API Key（选填）</label>
              <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-" />
            </div>
            {err && <div className="err">{err}</div>}
            <div className="onboard-actions">
              <button onClick={() => onDone(source || "qwen", "")}>暂不设置，继续</button>
              <button className="primary" disabled={checking} onClick={checkAndContinue}>
                {checking ? "检测中…" : "检测并继续"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
