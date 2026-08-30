import { useEffect, useState } from "react";
import {
  archiveHealth,
  listSeries,
  listEpisodes,
  deleteSeries,
  deleteEpisode,
  pickArchiveDir,
  checkArchiveDir,
  type SeriesListItem,
  type EpisodeRef
} from "../lib/archive";
import {
  loadArchiveDir,
  saveArchiveDir,
  loadSource,
  saveSource,
  loadEdgeUrl,
  saveEdgeUrl,
  loadQwenUrl,
  saveQwenUrl,
  loadDsKey,
  saveDsKey,
  loadAiEnabled,
  saveAiEnabled,
  type TtsSource
} from "../lib/settings";
import { checkHealth } from "../lib/tts";
import SettingsModal from "../components/SettingsModal";
import type { Theme } from "../lib/theme";
import type { ArchiveContext } from "../lib/types";

type DeleteTarget =
  | { type: "series"; id: string; name: string }
  | { type: "episode"; seriesId: string; seriesName: string; id: string; name: string };

export default function ArchiveContinuePage({ onContinue, onBack, theme, onTheme }: {
  onContinue: (ctx: ArchiveContext) => Promise<boolean>;
  onBack: () => void;
  theme: Theme;
  onTheme: (t: Theme) => void;
}) {
  const [dir, setDir] = useState(loadArchiveDir);
  const [ok, setOk] = useState<boolean | null>(null);
  const [series, setSeries] = useState<SeriesListItem[]>([]);
  const [openId, setOpenId] = useState("");
  const [episodes, setEpisodes] = useState<EpisodeRef[]>([]);
  const [busy, setBusy] = useState(false);
  const [episodesBusy, setEpisodesBusy] = useState(false);
  const [err, setErr] = useState("");
  const [loadingKey, setLoadingKey] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState("");
  const [source, setSource] = useState<TtsSource>(loadSource);
  const [edgeUrl, setEdgeUrl] = useState(loadEdgeUrl);
  const [qwenUrl, setQwenUrl] = useState(loadQwenUrl);
  const [dsKey, setDsKey] = useState(loadDsKey);
  const [aiEnabled, setAiEnabled] = useState(loadAiEnabled);
  const [serviceOk, setServiceOk] = useState<boolean | null>(null);
  const [dirOk, setDirOk] = useState<boolean | null>(null);
  const [showSettings, setShowSettings] = useState(false);

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

  useEffect(() => {
    let alive = true;
    const check = async () => {
      const url = source === "qwen" ? qwenUrl : edgeUrl;
      const ok = await checkHealth(url).catch(() => false);
      if (alive) setServiceOk(ok);
    };
    void check();
    const timer = setInterval(check, 30000);
    return () => { alive = false; clearInterval(timer); };
  }, [source, qwenUrl, edgeUrl]);

  useEffect(() => {
    let alive = true;
    checkArchiveDir(dir).then((ok) => { if (alive) setDirOk(ok); });
    return () => { alive = false; };
  }, [dir]);

  const pickDir = async () => {
    const picked = await pickArchiveDir();
    if (picked) {
      setDir(picked);
      saveArchiveDir(picked);
      await refresh();
    }
  };

  const openSeries = async (id: string) => {
    if (openId === id) {
      setOpenId("");
      setEpisodes([]);
      return;
    }
    setOpenId(id);
    setErr("");
    setEpisodesBusy(true);
    setEpisodes(await listEpisodes(dir, id));
    setEpisodesBusy(false);
  };

  const resume = async (s: SeriesListItem, ep: EpisodeRef) => {
    const key = s.id + ":" + ep.id;
    setLoadingKey(key);
    setErr("");
    const ok2 = await onContinue({ dir, series: s.id, seriesName: s.name, episode: ep.id, episodeName: ep.name });
    setLoadingKey("");
    if (!ok2) setErr("存档读取失败，请检查目录和存档文件");
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteErr("");
    const ok = deleteTarget.type === "series"
      ? await deleteSeries(dir, deleteTarget.id)
      : await deleteEpisode(dir, deleteTarget.seriesId, deleteTarget.id);
    setDeleting(false);
    if (!ok) {
      setDeleteErr("删除失败，请检查存档服务");
      return;
    }
    const target = deleteTarget;
    setDeleteTarget(null);
    await refresh();
    if (target.type === "episode") {
      setOpenId(target.seriesId);
      setEpisodesBusy(true);
      setEpisodes(await listEpisodes(dir, target.seriesId));
      setEpisodesBusy(false);
    }
  };

  return (
    <div className="archive-page">
      <header className="archive-top">
        <button className="tb-btn" onClick={onBack}>← 返回</button>
        <div className="work-top-tools">
          <select
            className="source-select"
            value={source}
            onChange={(e) => { const v = e.target.value as TtsSource; setSource(v); saveSource(v); }}
            title="声音来源"
          >
            <option value="qwen">Qwen3 1.7B</option>
            <option value="edge">edge-tts</option>
          </select>
          <span
            className={"svc-dot " + (serviceOk === null ? "unknown" : serviceOk ? "ok" : "down")}
            title={source === "qwen" ? ("Qwen3 " + qwenUrl) : ("edge-tts " + edgeUrl)}
          />
          <button className="lib-entry" onClick={() => setShowSettings((v) => !v)}>设置</button>
        </div>
      </header>
      <div className="archive-body">
        <section className="card archive-card">
          <h2 className="archive-title">选择项目</h2>
          <div className="archive-dir-row">
            <input
              value={dir}
              onChange={(e) => { setDir(e.target.value); saveArchiveDir(e.target.value); }}
              placeholder="~/Documents/剧本围读存档"
            />
            <span
              className={"svc-dot " + (ok === null ? "unknown" : ok ? "ok" : "down")}
              title={"存档服务 " + (ok === null ? "检测中" : ok ? "正常" : "未启动")}
            />
            <button disabled={busy} onClick={refresh}>{busy ? "读取中…" : "刷新"}</button>
          </div>
          {err && <div className="err">{err}</div>}
          {!busy && !err && series.length === 0 && (
            <p className="archive-empty">这个工作区里还没有剧集存档</p>
          )}
          <div className="archive-list">
            {series.map((s) => (
              <div key={s.id} className="series-item">
                <div className="archive-row">
                  <button className="resume-item" onClick={() => openSeries(s.id)}>
                    <span className="resume-name">{s.name}</span>
                    <span className="resume-meta">{s.episodes}集·{s.voices}音色</span>
                    <span className="resume-date">{s.updatedAt}</span>
                  </button>
                  <button
                    className="archive-delete"
                    onClick={() => setDeleteTarget({ type: "series", id: s.id, name: s.name })}
                    title="删除项目"
                    aria-label="删除项目"
                  >✕</button>
                </div>
                {openId === s.id && (
                  <div className="episode-list">
                    {episodesBusy ? (
                      <p className="archive-empty">载入中…</p>
                    ) : episodes.length === 0 ? (
                      <p className="archive-empty">这部剧还没有集</p>
                    ) : episodes.map((ep) => (
                      <div key={ep.id} className="archive-row episode-row">
                        <button
                          className="resume-item episode-item"
                          disabled={loadingKey === s.id + ":" + ep.id}
                          onClick={() => resume(s, ep)}
                        >
                          <span className="resume-name">{loadingKey === s.id + ":" + ep.id ? "载入中…" : ep.name}</span>
                          {ep.full && <span className="full-audio-badge">完整音频</span>}
                        </button>
                        <button
                          className="archive-delete"
                          onClick={() => setDeleteTarget({ type: "episode", seriesId: s.id, seriesName: s.name, id: ep.id, name: ep.name })}
                          title="删除这一集"
                          aria-label="删除这一集"
                        >✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
      {deleteTarget && (
        <div className="modal-mask" onClick={() => { if (!deleting) setDeleteTarget(null); }}>
          <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
            <header className="lib-top">
              <span className="lib-title">删除确认</span>
              <button className="lib-close" disabled={deleting} onClick={() => setDeleteTarget(null)} aria-label="关闭">✕</button>
            </header>
            <div className="regen-body">
              <p className="delete-warn">该操作不可逆，删除后无法恢复。</p>
              <p className="delete-name">
                确定要删除「{deleteTarget.name}」吗？
                {deleteTarget.type === "series" && "整部剧及其所有集的音频、音色库都会被删除。"}
              </p>
              {deleteErr && <div className="err">{deleteErr}</div>}
              <div className="regen-actions">
                <button className="secondary-pill" disabled={deleting} onClick={() => setDeleteTarget(null)}>取消</button>
                <button className="primary danger" disabled={deleting} onClick={confirmDelete}>
                  {deleting ? "删除中…" : "删除"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showSettings && (
        <SettingsModal
          source={source}
          theme={theme}
          onTheme={onTheme}
          edgeUrl={edgeUrl}
          onEdgeUrl={(v) => { setEdgeUrl(v); saveEdgeUrl(v); }}
          qwenUrl={qwenUrl}
          onQwenUrl={(v) => { setQwenUrl(v); saveQwenUrl(v); }}
          dsKey={dsKey}
          onDsKey={(v) => { setDsKey(v); saveDsKey(v); }}
          archiveDir={dir}
          dirOk={dirOk}
          onPickDir={pickDir}
          aiEnabled={aiEnabled}
          onAiEnabled={(v) => { setAiEnabled(v); saveAiEnabled(v); }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
