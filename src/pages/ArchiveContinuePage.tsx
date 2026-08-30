import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  archiveHealth,
  listSeries,
  listEpisodes,
  deleteSeries,
  deleteEpisode,
  pickArchiveDir,
  checkArchiveDir,
  revealDir,
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
  loadHiddenSeries,
  saveHiddenSeries,
  type TtsSource
} from "../lib/settings";
import { checkHealth, fetchTtsStatus } from "../lib/tts";
import SettingsModal from "../components/SettingsModal";
import type { Theme } from "../lib/theme";
import type { ArchiveContext } from "../lib/types";

type DeleteTarget =
  | { type: "series"; id: string; name: string }
  | { type: "episode"; seriesId: string; seriesName: string; id: string; name: string };

function EyeIcon({ closed = false, size = 20 }: { closed?: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {closed ? (
        <>
          <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
          <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
          <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
          <path d="m2 2 20 20" />
        </>
      ) : (
        <>
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

export default function ArchiveContinuePage({ onContinue, onBack, theme, onTheme }: {
  onContinue: (ctx: ArchiveContext) => Promise<boolean>;
  onBack: () => void;
  theme: Theme;
  onTheme: (t: Theme) => void;
}) {
  const [dir, setDir] = useState(loadArchiveDir);
  const [series, setSeries] = useState<SeriesListItem[]>([]);
  const [openId, setOpenId] = useState("");
  const [episodes, setEpisodes] = useState<EpisodeRef[]>([]);
  const [busy, setBusy] = useState(false);
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
  const [serviceBusy, setServiceBusy] = useState(false);
  const [dirOk, setDirOk] = useState<boolean | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [hiddenIds, setHiddenIds] = useState<string[]>(() => loadHiddenSeries(dir));
  const [revealing, setRevealing] = useState(false);
  const hiddenSet = useMemo(() => new Set(hiddenIds), [hiddenIds]);
  const topRef = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);

  const refresh = async () => {
    setErr("");
    setBusy(true);
    const up = await archiveHealth();
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
      let busy = false;
      if (ok && source === "qwen") {
        const st = await fetchTtsStatus(qwenUrl);
        const d = st?.design;
        const c = st?.clone;
        busy = !!(d?.busy && d.runningSec > 60) || !!(c?.busy && c.runningSec > 60);
      }
      if (alive) { setServiceOk(ok); setServiceBusy(busy); }
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

  useEffect(() => {
    setHiddenIds(loadHiddenSeries(dir));
    setRevealing(false);
  }, [dir]);

  useEffect(() => {
    saveHiddenSeries(dir, hiddenIds);
  }, [dir, hiddenIds]);

  useEffect(() => {
    if (hiddenIds.length === 0) setRevealing(false);
  }, [hiddenIds]);

  const pickDir = async () => {
    const picked = await pickArchiveDir();
    if (picked) {
      setDir(picked);
      saveArchiveDir(picked);
      await refresh();
    }
  };

  const toggleSeriesHidden = (id: string) => {
    if (!hiddenSet.has(id)) setOpenId((o) => (o === id ? "" : o));
    setHiddenIds((prev) => prev.includes(id)
      ? prev.filter((x) => x !== id)
      : [...prev, id]);
  };

  const toggleReveal = () => {
    if (hiddenIds.length > 0) setRevealing((v) => !v);
  };

  const openDir = async () => {
    await revealDir(dir);
  };

  const positionCard = useCallback((instant = false) => {
    const card = cardRef.current;
    const top = topRef.current;
    if (!card || !top) return;
    const topH = top.getBoundingClientRect().height;
    const cardH = card.getBoundingClientRect().height;
    const areaH = window.innerHeight - topH;
    const y = Math.max(24, 0.45 * areaH - cardH / 2);
    if (instant) card.style.transition = "none";
    card.style.transform = `translateY(${y}px)`;
    if (instant) {
      requestAnimationFrame(() => { card.style.transition = ""; });
    }
  }, []);

  useLayoutEffect(() => {
    positionCard(true);
    const card = cardRef.current;
    if (!card) return;
    const ro = new ResizeObserver(() => positionCard());
    ro.observe(card);
    const onResize = () => positionCard();
    window.addEventListener("resize", onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [positionCard]);

  const openSeries = async (id: string) => {
    if (openId === id) {
      setOpenId("");
      setEpisodes([]);
      return;
    }
    setErr("");
    const eps = await listEpisodes(dir, id);
    setOpenId(id);
    setEpisodes(eps);
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
      const eps = await listEpisodes(dir, target.seriesId);
      setOpenId(target.seriesId);
      setEpisodes(eps);
    }
  };

  return (
    <div className="archive-page">
      <header className="archive-top" ref={topRef}>
        <button className="back-btn" onClick={onBack}>← 返回</button>
        <div className="work-top-tools">
          <div
            className="model-chip"
            title={serviceOk === false ? "服务未启动" : serviceBusy ? "生成中（可能异常，请稍候）" : (source === "qwen" ? ("Qwen3 " + qwenUrl) : ("edge-tts " + edgeUrl))}
          >
            <span className={"svc-dot " + (serviceOk === null ? "unknown" : serviceBusy ? "busy" : serviceOk ? "ok" : "down")} />
            <select
              className="model-source-select"
              value={source}
              onChange={(e) => { const v = e.target.value as TtsSource; setSource(v); saveSource(v); }}
              title="声音来源"
            >
              <option value="qwen">Qwen3 1.7B</option>
              <option value="edge">edge-tts</option>
            </select>
          </div>
          <button className="top-chip" onClick={() => setShowSettings((v) => !v)}>设置</button>
        </div>
      </header>
      <div className="archive-body">
        <section className="card archive-card" ref={cardRef}>
          <h2 className="archive-title">选择项目</h2>
          <div className="archive-dir-row">
            <input
              value={dir}
              readOnly
              onClick={() => void openDir()}
              placeholder="~/Documents/剧本围读存档"
              title="在访达中打开该目录"
            />
            <button
              className="archive-dir-eye"
              onClick={toggleReveal}
              disabled={hiddenIds.length === 0}
              title={hiddenIds.length === 0 ? "没有隐藏项目" : revealing ? "隐藏灰色项目" : "显示隐藏项目"}
              aria-label={hiddenIds.length === 0 ? "没有隐藏项目" : revealing ? "隐藏灰色项目" : "显示隐藏项目"}
            >
              <EyeIcon closed={hiddenIds.length > 0} size={20} />
            </button>
          </div>
          {err && <div className="err">{err}</div>}
          {!busy && !err && series.length === 0 && (
            <p className="archive-empty">这个工作区里还没有剧集存档</p>
          )}
          <div className="archive-list">
            {series.map((s) => {
              const hidden = hiddenSet.has(s.id);
              if (hidden && !revealing) return null;
              return (
                <div key={s.id} className={"series-item" + (hidden ? " hidden-reveal" : "")}>
                  <div className="archive-row">
                    <div
                      className="resume-item series-resume"
                      role="button"
                      tabIndex={0}
                      onClick={() => openSeries(s.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openSeries(s.id);
                        }
                      }}
                    >
                      <span className="resume-name">{s.name}</span>
                      <span className="resume-meta">{s.episodes}集·{s.voices}音色</span>
                      <button
                        className="archive-eye-inline"
                        onClick={(e) => { e.stopPropagation(); toggleSeriesHidden(s.id); }}
                        title={hidden ? "取消隐藏" : "隐藏项目"}
                        aria-label={hidden ? "取消隐藏" : "隐藏项目"}
                      >
                        <EyeIcon closed={hidden} size={14} />
                      </button>
                      <span className="resume-date">{s.updatedAt}</span>
                    </div>
                    <button
                      className="archive-delete"
                      onClick={() => setDeleteTarget({ type: "series", id: s.id, name: s.name })}
                      title="删除项目"
                      aria-label="删除项目"
                    >✕</button>
                  </div>
                  {openId === s.id && (
                    <div className="episode-list">
                      {episodes.length === 0 ? (
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
              );
            })}
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
