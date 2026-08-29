import { useEffect, useState } from "react";
import {
  archiveHealth,
  listSeries,
  listEpisodes,
  type SeriesListItem,
  type EpisodeRef
} from "../lib/archive";
import { loadArchiveDir, saveArchiveDir } from "../lib/settings";
import type { ArchiveContext } from "../lib/types";

export default function ArchiveContinuePage({ onContinue, onBack }: {
  onContinue: (ctx: ArchiveContext) => Promise<boolean>;
  onBack: () => void;
}) {
  const [dir, setDir] = useState(loadArchiveDir);
  const [ok, setOk] = useState<boolean | null>(null);
  const [series, setSeries] = useState<SeriesListItem[]>([]);
  const [openId, setOpenId] = useState("");
  const [episodes, setEpisodes] = useState<EpisodeRef[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [loadingKey, setLoadingKey] = useState("");

  const refresh = async () => {
    setErr("");
    setBusy(true);
    const up = await archiveHealth();
    setOk(up);
    if (!up) {
      setSeries([]);
      setBusy(false);
      setErr("存档服务未启动，请先运行桌面快捷入口");
      return;
    }
    setSeries(await listSeries(dir));
    setOpenId("");
    setEpisodes([]);
    setBusy(false);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const openSeries = async (id: string) => {
    setOpenId(id);
    setErr("");
    setBusy(true);
    setEpisodes(await listEpisodes(dir, id));
    setBusy(false);
  };

  const resume = async (s: SeriesListItem, ep: EpisodeRef) => {
    const key = s.id + ":" + ep.id;
    setLoadingKey(key);
    setErr("");
    const ok2 = await onContinue({ dir, series: s.id, seriesName: s.name, episode: ep.id, episodeName: ep.name });
    setLoadingKey("");
    if (!ok2) setErr("存档读取失败，请检查目录和存档文件");
  };

  return (
    <div className="archive-page">
      <header className="archive-top">
        <button className="tb-btn" onClick={onBack}>← 返回</button>
        <span className="tb-info">继续围读</span>
      </header>
      <div className="archive-body">
        <section className="card archive-card">
          <h2 className="archive-title">选择剧集</h2>
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
          {!busy && !err && series.length === 0 && (
            <p className="archive-empty">这个工作区里还没有剧集存档</p>
          )}
          <div className="archive-list">
            {series.map((s) => (
              <div key={s.id} className="series-item">
                <button className="resume-item" onClick={() => openSeries(s.id)}>
                  <span className="resume-name">{s.name}</span>
                  <span className="resume-time">{s.episodes} 集 · {s.voices} 音色 · {s.updatedAt}</span>
                </button>
                {openId === s.id && (
                  <div className="episode-list">
                    {episodes.length === 0 && <p className="archive-empty">这部剧还没有集</p>}
                    {episodes.map((ep) => (
                      <button
                        key={ep.id}
                        className="resume-item episode-item"
                        disabled={loadingKey === s.id + ":" + ep.id}
                        onClick={() => resume(s, ep)}
                      >
                        <span className="resume-name">{loadingKey === s.id + ":" + ep.id ? "载入中…" : ep.name}</span>
                        {ep.full && <span className="full-audio-badge">完整音频</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
