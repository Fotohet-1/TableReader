import type { Theme } from "../lib/theme";
import { clearOnboarded, APP_VERSION, type TtsSource } from "../lib/settings";
import SecretInput from "./SecretInput";

export default function SettingsModal({ source, theme, onTheme, edgeUrl, onEdgeUrl, qwenUrl, onQwenUrl, dsKey, onDsKey, archiveDir, dirOk, onPickDir, aiEnabled, onAiEnabled, onClose }: {
  source: TtsSource;
  theme: Theme;
  onTheme: (t: Theme) => void;
  edgeUrl: string;
  onEdgeUrl: (v: string) => void;
  qwenUrl: string;
  onQwenUrl: (v: string) => void;
  dsKey: string;
  onDsKey: (v: string) => void;
  archiveDir: string;
  dirOk: boolean | null;
  onPickDir: () => void;
  aiEnabled: boolean;
  onAiEnabled: (v: boolean) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <header className="lib-top">
          <span className="lib-title">设置</span>
          <button className="lib-close" onClick={onClose} aria-label="关闭">✕</button>
        </header>
        <div className="settings-body">
          {source === "edge" ? (
            <div className="field">
              <label>edge-tts 地址</label>
              <input value={edgeUrl} onChange={(e) => onEdgeUrl(e.target.value)} />
            </div>
          ) : (
            <div className="field">
              <label>Qwen3 地址</label>
              <input value={qwenUrl} onChange={(e) => onQwenUrl(e.target.value)} />
            </div>
          )}
          <div className="field">
            <label>DeepSeek Key</label>
            <SecretInput value={dsKey} onChange={onDsKey} placeholder="可选" />
          </div>
          <div className="field">
            <label>存档目录</label>
            <input
              className={"archive-dir" + (dirOk === false ? " bad" : "")}
              value={dirOk === false ? "路径丢失，请重新设置" : archiveDir}
              readOnly
              onClick={onPickDir}
              title="点击选择文件夹"
            />
          </div>
          <div className="field">
            <label>外观</label>
            <div className="seg" role="group" aria-label="外观">
              {([["system", "跟随系统"], ["light", "浅色"], ["dark", "深色"]] as const).map(([v, label]) => (
                <button
                  key={v}
                  className={"seg-btn" + (theme === v ? " on" : "")}
                  onClick={() => onTheme(v)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={aiEnabled}
              onChange={(e) => onAiEnabled(e.target.checked)}
            />
            DeepSeek 角色分析
          </label>
          <p className="settings-hint">Key 仅保存在本机浏览器</p>
          <div className="row">
            <button className="settings-link" onClick={() => onDsKey("")}>清除 Key</button>
            <button className="settings-link" onClick={() => { clearOnboarded(); window.location.reload(); }}>重新查看引导</button>
          </div>
          <div className="settings-about">
            <span>{APP_VERSION}</span>
            <span>Made by 河忐</span>
          </div>
        </div>
      </div>
    </div>
  );
}
