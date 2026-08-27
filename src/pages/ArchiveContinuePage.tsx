import { useEffect, useState } from "react";
import { archiveHealth, listProjects, type ArchiveProject } from "../lib/archive";
import { loadArchiveDir, saveArchiveDir } from "../lib/settings";

export default function ArchiveContinuePage({ onContinue, onBack }: {
  onContinue: (dir: string, id: string, name: string) => Promise<boolean>;
  onBack: () => void;
}) {
  const [dir, setDir] = useState(loadArchiveDir);
  const [ok, setOk] = useState<boolean | null>(null);
  const [projects, setProjects] = useState<ArchiveProject[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [loadingId, setLoadingId] = useState("");

  const refresh = async () => {
    setErr("");
    setBusy(true);
    const up = await archiveHealth();
    setOk(up);
    if (!up) {
      setProjects([]);
      setBusy(false);
      setErr("存档服务未启动，请先运行桌面快捷入口");
      return;
    }
    setProjects(await listProjects(dir));
    setBusy(false);
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div className="archive-page">
      <header className="archive-top">
        <button className="tb-btn" onClick={onBack}>← 返回</button>
        <span className="tb-info">继续围读</span>
      </header>
      <div className="archive-body">
        <section className="card archive-card">
          <h2 className="archive-title">选择存档</h2>
          <div className="archive-dir-row">
            <input
              value={dir}
              onChange={(e) => { setDir(e.target.value); saveArchiveDir(e.target.value); }}
              placeholder="~/Documents/剧本围读存档"
            />
            <button disabled={busy} onClick={refresh}>{busy ? "读取中…" : "刷新"}</button>
            <span
              className={"svc-dot " + (ok === null ? "unknown" : ok ? "ok" : "down")}
              title={"存档服务 " + (ok === null ? "检测中" : ok ? "正常" : "未启动")}
            />
          </div>
          {err && <div className="err">{err}</div>}
          {!busy && !err && projects.length === 0 && (
            <p className="archive-empty">这个目录里还没有存档项目</p>
          )}
          <div className="archive-list">
            {projects.map((p) => (
              <button
                key={p.id}
                className="resume-item"
                disabled={loadingId === p.id}
                onClick={async () => {
                  setErr("");
                  setLoadingId(p.id);
                  const ok2 = await onContinue(dir, p.id, p.name);
                  setLoadingId("");
                  if (!ok2) setErr("存档读取失败，请检查目录和存档文件");
                }}
              >
                <span className="resume-name">{loadingId === p.id ? "载入中…" : p.name}</span>
                <span className="resume-time">{p.updatedAt}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
