import { useEffect, useRef, useState } from "react";
import type { CharacterVoice, Project, Session, Unit, UnitAudio } from "../lib/types";
import { parseScript, collectCharacters } from "../lib/parser";
import { groupRoles } from "../lib/roles";
import { guessGender, defaultEdgeVoiceFor, defaultBaseVoiceFor } from "../lib/voices";
import { analyzeRolesWithLLM } from "../lib/llm";
import { synthesizeStream, type Progress, type SynthSummary } from "../lib/synth";
import {
  checkHealth,
  edgeSynthOne,
  fetchBaseVoices,
  fetchEdgeVoices,
  localSynthOne,
  registerRoles,
  type BaseVoiceInfo,
  type RoleVoiceCfg
} from "../lib/tts";
import mammoth from "mammoth/mammoth.browser.js";
import VoiceLibrary from "../components/VoiceLibrary";
import {
  loadVoiceTags,
  saveVoiceTags,
  tagLabelFor,
  type VoiceTag
} from "../lib/voiceTags";

const LS_EDGE_URL = "sr_edge_url";
const LS_LOCAL_URL = "sr_local_url";
const LS_SOURCE = "sr_tts_source";
const LS_DS_KEY = "sr_ds_key";
const LS_AI = "sr_ai_roles";

const SAMPLE = `1. 咖啡店 日 内
林晚 推门进来，风铃响了一声。
林晚：一杯美式，谢谢。
老板：今天还是老样子？
林晚：嗯，老样子。
（老板转身去冲咖啡）
旁白：她不知道，这个决定会改变一切。`;

type Source = "edge" | "local";
type Gender = "男" | "女" | "未知";

interface Profile {
  name: string;
  gender: Gender;
  age?: string;
  merged?: string[];
}

export default function UploadPage({ lastSession, onAnalyzed, resetItems, registerUnit, markSynthDone, setProject, onEnterPlayer }: {
  lastSession: Session | null;
  onAnalyzed: (s: Session) => void;
  resetItems: () => void;
  registerUnit: (item: UnitAudio) => void;
  markSynthDone: () => void;
  setProject: (p: Project) => void;
  onEnterPlayer: () => void;
}) {
  const [source, setSourceState] = useState<Source>(() => {
    const v = localStorage.getItem(LS_SOURCE);
    return v === "local" ? "local" : "edge";
  });
  const [edgeUrl, setEdgeUrlState] = useState(() => localStorage.getItem(LS_EDGE_URL) || "http://127.0.0.1:9882");
  const [localUrl, setLocalUrlState] = useState(() => localStorage.getItem(LS_LOCAL_URL) || "http://127.0.0.1:9880");
  const [dsKey, setDsKey] = useState(() => localStorage.getItem(LS_DS_KEY) || "");
  const [aiEnabled, setAiEnabled] = useState(() => localStorage.getItem(LS_AI) !== "0");

  const restored = lastSession && lastSession.source === source;
  const [tab, setTab] = useState<"file" | "paste">("file");
  const [fileInfo, setFileInfo] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [text, setText] = useState(() => (lastSession && lastSession.source === source ? lastSession.text : ""));
  const [units, setUnits] = useState<Unit[] | null>(() => (lastSession && lastSession.source === source ? lastSession.units : null));
  const [charVoices, setCharVoices] = useState<CharacterVoice[]>(() => (lastSession && lastSession.source === source ? lastSession.charVoices : []));
  const [phase, setPhase] = useState<"upload" | "gender" | "voices">("upload");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [genderSel, setGenderSel] = useState<Record<string, Gender>>({});
  const [baseVoices, setBaseVoices] = useState<Record<string, BaseVoiceInfo>>({});
  const [edgeVoices, setEdgeVoices] = useState<Record<string, BaseVoiceInfo>>({});
  const [localUrls, setLocalUrls] = useState<string[]>([localUrl]);
  const [aiState, setAiState] = useState<"idle" | "running" | "done">("idle");
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [summary, setSummary] = useState<SynthSummary | null>(null);
  const [canEnter, setCanEnter] = useState(false);
  const [err, setErr] = useState("");
  const [eta, setEta] = useState(0);
  const [showLibrary, setShowLibrary] = useState(false);
  const [voiceTags, setVoiceTags] = useState<Record<string, VoiceTag>>(() => loadVoiceTags());
  const [voiceFilter, setVoiceFilter] = useState({ gender: "", age: "", dialect: "" });
  const fileRef = useRef<HTMLInputElement>(null);
  const t0Ref = useRef(0);

  useEffect(() => {
    if (source === "local") {
      fetchBaseVoices(localUrl).then(setBaseVoices);
      const u2 = localUrl.replace(/:\d+$/, ":9881");
      checkHealth(u2).then((ok) => setLocalUrls(ok ? [localUrl, u2] : [localUrl]));
    } else {
      fetchEdgeVoices(edgeUrl).then(setEdgeVoices);
    }
  }, [source, localUrl, edgeUrl]);

  const saveEdgeUrl = (v: string) => {
    setEdgeUrlState(v);
    localStorage.setItem(LS_EDGE_URL, v);
  };

  const saveLocalUrl = (v: string) => {
    setLocalUrlState(v);
    localStorage.setItem(LS_LOCAL_URL, v);
  };

  const switchSource = (s: Source) => {
    localStorage.setItem(LS_SOURCE, s);
    setSourceState(s);
    setUnits(null);
    setCharVoices([]);
    setProfiles([]);
    setGenderSel({});
    setPhase("upload");
    setSummary(null);
    setCanEnter(false);
    setErr("");
  };

  const handleFile = async (f: File) => {
    const name = f.name.toLowerCase();
    setErr("");
    try {
      if (name.endsWith(".docx")) {
        const buf = await f.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer: buf });
        const v = (result.value || "").trim();
        if (!v) throw new Error("未从 Word 中提取到文本，请检查文件内容");
        setText(v);
        setFileInfo(f.name + " · 提取 " + v.length + " 字");
      } else if (name.endsWith(".txt") || name.endsWith(".md")) {
        const v = await f.text();
        setText(v);
        setFileInfo(f.name + " · " + v.length + " 字");
      } else if (name.endsWith(".doc")) {
        throw new Error(".doc 是老格式，浏览器无法直接解析。请在 Word 中打开后另存为 .docx 再上传");
      } else {
        throw new Error("请上传 .docx 或 .txt 文件");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const assignVoicesFor = (ps: Profile[]): CharacterVoice[] => {
    if (source === "edge") {
      const used = new Set<string>();
      used.add("zh-CN-XiaoxiaoNeural"); // 旁白固定占用晓晓原声
      return ps.map((p) => {
        if (p.name === "旁白") {
          return { name: p.name, voiceId: "zh-CN-XiaoxiaoNeural", gender: p.gender, age: p.age };
        }
        const voiceId = pickEdgeVoice(p, used);
        used.add(voiceId);
        return { name: p.name, voiceId, gender: p.gender, age: p.age };
      });
    }
    return ps.map((p) => ({
      name: p.name,
      voiceId: p.name,
      gender: p.gender,
      age: p.age,
      voiceMode: "base",
      voiceBase: defaultBaseVoiceFor(p, baseVoices)
    }));
  };

  const pickEdgeVoice = (p: { name?: string; gender?: string; age?: string }, used: Set<string>): string => {
    const keys = Object.keys(edgeVoices);
    const gender = p.gender === "男" ? "男" : p.gender === "女" ? "女" : "";
    const age = p.age || "";
    const find = (pred: (t?: VoiceTag) => boolean): string | null => {
      for (const k of keys) {
        if (!used.has(k) && pred(voiceTags[k])) return k;
      }
      return null;
    };
    let vid = find((t) => !!t && t.gender === gender && t.age === age);
    if (!vid) vid = find((t) => !!t && t.gender === gender);
    if (!vid) vid = find(() => true);
    return vid || defaultEdgeVoiceFor({ name: p.name || "", gender: gender || "女", age });
  };

  const changeVoice = (name: string, newVoiceId: string) => {
    setCharVoices((cs) => {
      const target = cs.find((c) => c.name === name);
      if (!target || target.voiceId === newVoiceId) return cs;
      return cs.map((c) => {
        if (c.name === name) return { ...c, voiceId: newVoiceId };
        if (newVoiceId && c.voiceId === newVoiceId) return { ...c, voiceId: "" };
        return c;
      });
    });
  };

  const analyze = async () => {
    if (!text.trim()) { setErr("请先上传或粘贴剧本"); return; }
    setErr("");
    setAiState("running");
    const us = parseScript(text);
    const rawNames = collectCharacters(us);
    const groups = groupRoles(rawNames);
    let profiles: Profile[] = groups.map((g) => ({
      name: g.canonical,
      gender: guessGender(g.canonical),
      age: "",
      merged: g.variants
    }));
    let mapping: Record<string, string> = {};
    if (aiEnabled && dsKey.trim()) {
      try {
        const llm = await analyzeRolesWithLLM(dsKey.trim(), rawNames, text);
        profiles = llm.profiles.map((p) => ({
          name: p.name,
          gender: p.gender as Gender,
          age: p.age,
          merged: p.merged
        }));
        mapping = llm.mapping;
      } catch {
        for (const g of groups) for (const v of g.variants) mapping[v] = g.canonical;
      }
    } else {
      for (const g of groups) for (const v of g.variants) mapping[v] = g.canonical;
    }
    profiles = profiles.filter((p) => p.name.trim().length > 0);
    const narr = profiles.find((p) => p.name === "旁白");
    if (narr) {
      if (narr.gender === "未知") narr.gender = "女";
      if (!narr.age) narr.age = "中年";
    } else {
      profiles = [...profiles, { name: "旁白", gender: "女", age: "中年", merged: [] }];
    }
    const us2 = us.map((u) => ({
      ...u,
      character: u.type === "narration" || u.type === "action" || u.type === "scene"
        ? "旁白"
        : (mapping[u.character] || u.character) || "旁白"
    }));
    setUnits(us2);
    setProfiles(profiles);
    setGenderSel(Object.fromEntries(profiles.map((p) => [p.name, p.gender])));
    setPhase("gender");
    setAiState("done");
  };

  const confirmGender = () => {
    const confirmed = profiles.map((p) => ({ ...p, gender: genderSel[p.name] || p.gender }));
    const ncv = assignVoicesFor(confirmed);
    setCharVoices(ncv);
    if (units) onAnalyzed({ text, units, charVoices: ncv, source });
    setPhase("voices");
  };

  const uploadClone = (cv: CharacterVoice) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/wav,audio/mpeg,.wav,.mp3";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      const refText = window.prompt("这段音频说的是什么？");
      if (refText == null || !refText.trim()) { alert("请填写转写文本"); return; }
      const buf = await f.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
      }
      const b64 = btoa(binary);
      setCharVoices((cs) => cs.map((c) => (c.name === cv.name ? { ...c, voiceMode: "clone", cloneAudioB64: b64, cloneRefText: refText.trim() } : c)));
    };
    input.click();
  };

  const start = async () => {
    if (!units || !charVoices.length) return;
    resetItems();
    setSyncing(true);
    setErr("");
    setCanEnter(false);
    setSummary(null);
    setProgress(null);
    t0Ref.current = Date.now();
    setEta(0);

    const needed = new Set(units.map((u) => u.character));
    const missing = Array.from(needed).filter((n) => !charVoices.some((c) => c.name === n));
    const defaults: CharacterVoice[] = missing.map((n) => (
      source === "edge"
        ? { name: n, voiceId: "" }
        : { name: n, voiceId: n, voiceMode: "base", voiceBase: defaultBaseVoiceFor({ name: n }, baseVoices) }
    ));
    const fullVoices = [...charVoices, ...defaults];
    if (source === "edge") {
      const used = new Set(fullVoices.map((c) => c.voiceId).filter(Boolean));
      for (const cv of fullVoices) {
        if (!cv.voiceId) {
          const vid = pickEdgeVoice(cv, used);
          cv.voiceId = vid;
          used.add(vid);
        }
      }
    }
    const project: Project = { scriptText: text, units, voices: fullVoices };
    setProject(project);

    if (source === "local") {
      try {
        const roles: Record<string, RoleVoiceCfg> = {};
        for (const cv of fullVoices) {
          roles[cv.name] = cv.voiceMode === "clone"
            ? { mode: "clone", audioB64: cv.cloneAudioB64, refText: cv.cloneRefText }
            : { mode: "base", value: cv.voiceBase };
        }
        for (const u of localUrls) await registerRoles(u, roles);
      } catch (e) {
        setErr("角色音色注册失败: " + String(e));
        setSyncing(false);
        return;
      }
    }

    const stream = synthesizeStream(project, {
      firstBatchSize: 25,
      onUnitReady: registerUnit,
      onProgress: (p) => {
        setProgress(p);
        if (p.done > 0 && p.total > 0) {
          const elapsed = (Date.now() - t0Ref.current) / 1000 / 60;
          setEta(Math.max(0, Math.round((elapsed / p.done) * (p.total - p.done))));
        }
      },
      synthFn: (t, v, idx) => (
        source === "local"
          ? localSynthOne(localUrls[(idx || 0) % localUrls.length], t, v)
          : edgeSynthOne(edgeUrl, t, v)
      )
    });
    stream.firstReady.then(() => setCanEnter(true));
    stream.done.then((s) => {
      setSummary(s);
      setSyncing(false);
      markSynthDone();
    });
  };

  const cats: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(baseVoices)) {
    (cats[v.category] = cats[v.category] || []).push(k);
  }
  const edgeCats: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(edgeVoices)) {
    (edgeCats[v.category] = edgeCats[v.category] || []).push(k);
  }
  const visibleEdgeKeys = Object.keys(edgeVoices).filter((key) => {
    const tag = voiceTags[key];
    if (!tag) return true;
    if (voiceFilter.gender && tag.gender !== voiceFilter.gender) return false;
    if (voiceFilter.age && tag.age !== voiceFilter.age) return false;
    if (voiceFilter.dialect === "none" && tag.dialect) return false;
    if (voiceFilter.dialect === "has" && !tag.dialect) return false;
    return true;
  });

  return (
    <div className="work">
      <header className="work-top">
        <span className="work-title">剧本围读</span>
        <span className="work-version">v1</span>
        <div className="src-switch">
          <button className={source === "edge" ? "on" : ""} onClick={() => switchSource("edge")}>edge-tts</button>
          <button className={source === "local" ? "on" : ""} onClick={() => switchSource("local")}>本地 CosyVoice</button>
        </div>
        <span className="top-status">{source === "edge" ? edgeUrl : localUrl}</span>
        <button className="lib-entry" onClick={() => setShowLibrary(true)}>音色库</button>
      </header>

      <div className="work-grid">
        <section className="card">
          <div className="card-head">
            <h2>剧本</h2>
            <div className="tabs">
              <button className={"tab" + (tab === "file" ? " active" : "")} onClick={() => setTab("file")}>上传文件</button>
              <button className={"tab" + (tab === "paste" ? " active" : "")} onClick={() => setTab("paste")}>粘贴文本</button>
            </div>
          </div>
          {tab === "file" ? (
            <>
              <div
                className={"upload-zone" + (dragOver ? " drag" : "")}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
              >
                <div className="uz-icon">📄</div>
                <div className="uz-main">选择或拖入剧本文件</div>
                <div className="uz-sub">支持 .docx / .txt</div>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".docx,.doc,.txt,.md"
                style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
              />
              {fileInfo && <div className="file-info">✓ {fileInfo}</div>}
            </>
          ) : (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={16}
              placeholder="在此粘贴剧本原文…"
            />
          )}
          <div className="row">
            {tab === "paste" && <button onClick={() => setText(SAMPLE)}>填入示例</button>}
            <button onClick={analyze} className="primary" disabled={aiState === "running"}>
              {aiState === "running" ? "解析中…" : "解析剧本"}
            </button>
          </div>
        </section>

        <aside className="side">
          <section className="card">
            <h2>设置</h2>
            {source === "edge" ? (
              <div className="field">
                <label>edge-tts 地址</label>
                <input value={edgeUrl} onChange={(e) => saveEdgeUrl(e.target.value)} />
              </div>
            ) : (
              <div className="field">
                <label>本地服务地址</label>
                <input value={localUrl} onChange={(e) => saveLocalUrl(e.target.value)} />
              </div>
            )}
            <div className="field">
              <label>DeepSeek Key</label>
              <input value={dsKey} onChange={(e) => { setDsKey(e.target.value); localStorage.setItem(LS_DS_KEY, e.target.value); }} placeholder="可选" />
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={aiEnabled}
                onChange={(e) => { setAiEnabled(e.target.checked); localStorage.setItem(LS_AI, e.target.checked ? "1" : "0"); }}
              />
              DeepSeek 角色分析
            </label>
          </section>

          {phase === "gender" && units && (
            <section className="card">
              <h2>确认角色性别 · {profiles.length} 人</h2>
              {profiles.map((p) => (
                <div className="cv-row" key={p.name}>
                  <span className="cv-name">{p.name}</span>
                  {p.merged && p.merged.length > 1 && <span className="cv-merged">{p.merged.length} 种写法</span>}
                  <div className="gender-pick">
                    {(["男", "女", "未知"] as const).map((g) => (
                      <button key={g} className={genderSel[p.name] === g ? "on" : ""} onClick={() => setGenderSel((s) => ({ ...s, [p.name]: g }))}>{g}</button>
                    ))}
                  </div>
                </div>
              ))}
              <button onClick={confirmGender} className="primary big">确认并分配音色</button>
            </section>
          )}

          {units && phase === "voices" && (
            <section className="card">
              <h2>角色与音色 · {units.length} 句</h2>
              <button className="link" onClick={() => setPhase("gender")}>修改性别</button>
              {source === "edge" && (
                <div className="voice-filters">
                  <select value={voiceFilter.gender} onChange={(e) => setVoiceFilter((f) => ({ ...f, gender: e.target.value }))}>
                    <option value="">全部性别</option>
                    <option value="男">男</option>
                    <option value="女">女</option>
                  </select>
                  <select value={voiceFilter.age} onChange={(e) => setVoiceFilter((f) => ({ ...f, age: e.target.value }))}>
                    <option value="">全部年龄</option>
                    <option value="少年">少年</option>
                    <option value="青年">青年</option>
                    <option value="中年">中年</option>
                    <option value="老年">老年</option>
                  </select>
                  <select value={voiceFilter.dialect} onChange={(e) => setVoiceFilter((f) => ({ ...f, dialect: e.target.value }))}>
                    <option value="">全部方言</option>
                    <option value="none">无方言</option>
                    <option value="has">有方言</option>
                  </select>
                </div>
              )}
              {charVoices.map((cv) => (
                <div className={"cv-row" + (source === "edge" && !cv.voiceId ? " unassigned" : "")} key={cv.name}>
                  <div className="cv-left">
                    <span className="cv-name">{cv.name}</span>
                    {cv.gender && <span className="cv-tag">{cv.gender}{cv.age ? " · " + cv.age : ""}</span>}
                  </div>
                  {source === "edge" ? (
                    <select value={cv.voiceId} onChange={(e) => changeVoice(cv.name, e.target.value)}>
                      <option value="">未分配</option>
                      {Object.keys(edgeCats).length ? Object.entries(edgeCats).map(([cat, vids]) => (
                        <optgroup key={cat} label={cat}>
                          {vids.filter((vid) => visibleEdgeKeys.includes(vid)).map((vid) => (
                            <option key={vid} value={vid}>{tagLabelFor(vid, edgeVoices[vid].source_name, voiceTags)}</option>
                          ))}
                        </optgroup>
                      )) : <option value={cv.voiceId}>{cv.voiceId}</option>}
                    </select>
                  ) : (
                    <div className="cv-local-pick">
                      {cv.voiceMode === "clone" ? (
                        <span className="cv-clone-tag">🎙️ 专属音色{cv.voiceBase ? "（" + cv.voiceBase + "）" : ""}</span>
                      ) : (
                        <select value={cv.voiceBase || ""} onChange={(e) => setCharVoices((cs) => cs.map((c) => (c.name === cv.name ? { ...c, voiceBase: e.target.value } : c)))}>
                          {Object.keys(cats).map((cat) => (
                            <optgroup key={cat} label={cat}>
                              {cats[cat].map((v) => <option key={v} value={v}>{v}（{baseVoices[v].source_name}）</option>)}
                            </optgroup>
                          ))}
                        </select>
                      )}
                      <button className="cv-upload" onClick={() => uploadClone(cv)}>上传专属音色</button>
                    </div>
                  )}
                </div>
              ))}
              <button onClick={start} disabled={syncing} className="primary big">
                {syncing ? "合成中…" : "开始合成"}
              </button>
              {!syncing && !summary && (
                <div className="prog">约 {Math.ceil(units.length / 45)} 分钟 · 满 25 句可先进入围读</div>
              )}
              {canEnter && (
                <div className="enter-box">
                  <span>{progress && progress.done > 0 ? "已合成 " + progress.done + " 句" : "可开始围读"}</span>
                  <button onClick={onEnterPlayer} className="primary">进入围读</button>
                </div>
              )}
              {summary && <div className="prog">合成完成：成功 {summary.ok} 句，失败 {summary.failed} 句</div>}
              {progress && (
                <div className="prog">
                  合成中 {progress.done}/{progress.total}
                  {eta > 0 ? " · 预计剩余 " + eta + " 分钟" : ""}
                  {progress.current ? " · " + progress.current + "…" : ""}
                  {progress.failed ? " · 失败 " + progress.failed : ""}
                </div>
              )}
              {err && <div className="err">{err}</div>}
            </section>
          )}
        </aside>
      </div>

      {showLibrary && (
        <VoiceLibrary
          edgeUrl={edgeUrl}
          voices={edgeVoices}
          onTagsChange={(tags) => { setVoiceTags(tags); saveVoiceTags(tags); }}
          onClose={() => setShowLibrary(false)}
        />
      )}
    </div>
  );
}
