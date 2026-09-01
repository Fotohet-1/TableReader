import { useEffect, useRef, useState } from "react";
import type { ArchiveContext, CharacterVoice, Project, Session, Unit, UnitAudio, VoiceSpec } from "../lib/types";
import { parseScript, collectCharacters, episodeFromName, findLikelySceneLines, roleBase } from "../lib/parser";
import { splitMultiEpisodeArchive, type EpisodeSegment } from "../lib/episodes";
import { groupRoles, sortRolesForConfirm } from "../lib/roles";
import { guessGender, defaultEdgeVoiceFor, defaultVoiceDescFor } from "../lib/voices";
import { analyzeRolesWithLLM, describeRoleVoice } from "../lib/llm";
import { synthesizeStream, type Progress, type SynthSummary } from "../lib/synth";
import { seriesKeyFromFile, slugify } from "../lib/series";
import {
  checkHealth,
  fetchTtsStatus,
  edgeSynthOne,
  fetchEdgeVoices,
  qwenCloneSynthOne,
  qwenSynthOne,
  type BaseVoiceInfo
} from "../lib/tts";
import VoiceLibrary from "../components/VoiceLibrary";
import SettingsModal from "../components/SettingsModal";
import {
  loadVoiceTags,
  saveVoiceTags,
  tagLabelFor,
  type VoiceTag
} from "../lib/voiceTags";
import {
  loadAiEnabled,
  loadArchiveDir,
  loadDsKey,
  loadEdgeUrl,
  loadQwenUrl,
  loadSource,
  saveAiEnabled,
  saveArchiveDir,
  saveDsKey,
  saveEdgeUrl as persistEdgeUrl,
  saveQwenUrl as persistQwenUrl,
  saveSource,
  type TtsSource
} from "../lib/settings";
import type { Theme } from "../lib/theme";
import {
  archiveAudioUrl,
  archiveHealth,
  checkArchiveDir,
  listSeries,
  loadMeta,
  loadVoiceBank,
  saveAudio,
  saveMeta,
  saveSeed,
  saveSeries,
  saveVoiceBank,
  seedUrl,
  mergeVoiceBanks,
  pickArchiveDir,
  type EpisodeMeta,
  type VoiceBankEntry
} from "../lib/archive";

type Source = TtsSource;
type Gender = "男" | "女" | "未知";

interface Profile {
  name: string;
  gender: Gender;
  age?: string;
  lines?: number;
  merged?: string[];
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buf);
  const str = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  str(0, "RIFF");
  view.setUint32(4, 36 + n * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, n * 2, true);
  let off = 44;
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return buf;
}

export default function UploadPage({ theme, onTheme, lastSession, onAnalyzed, resetItems, registerUnit, markSynthDone, setProject, onArchiveNew, onArchiveActive, onEnterPlayer, onBack, onFullReady, voiceMapRef, regenClaimedRef }: {
  theme: Theme;
  onTheme: (t: Theme) => void;
  lastSession: Session | null;
  onAnalyzed: (s: Session) => void;
  resetItems: () => void;
  registerUnit: (item: UnitAudio) => void;
  markSynthDone: () => void;
  setProject: (p: Project) => void;
  onArchiveNew: () => void;
  onArchiveActive: () => void;
  onEnterPlayer: () => void;
  onBack: () => void;
  onFullReady?: (ctx: ArchiveContext) => void;
  voiceMapRef: { current: Record<string, VoiceSpec> };
  regenClaimedRef: { current: Map<number, { url: string; durationMs: number }> };
}) {
  const [source, setSourceState] = useState<Source>(loadSource);
  const [edgeUrl, setEdgeUrlState] = useState(loadEdgeUrl);
  const [qwenUrl, setQwenUrlState] = useState(loadQwenUrl);
  const [dsKey, setDsKey] = useState(loadDsKey);
  const [aiEnabled, setAiEnabled] = useState(loadAiEnabled);

  const restored = lastSession && lastSession.source === source;
  const [showSettings, setShowSettings] = useState(false);
  const [fileInfo, setFileInfo] = useState("");
  const [fileName, setFileName] = useState("");
  const [text, setText] = useState(() => (lastSession && lastSession.source === source ? lastSession.text : ""));
  const [segments, setSegments] = useState<EpisodeSegment[] | null>(null);
  const [units, setUnits] = useState<Unit[] | null>(() => (lastSession && lastSession.source === source ? lastSession.units : null));
  const [charVoices, setCharVoices] = useState<CharacterVoice[]>(() => (lastSession && lastSession.source === source ? lastSession.charVoices : []));
  const [phase, setPhase] = useState<"upload" | "scenes" | "gender" | "design" | "voices">("upload");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [likelyLines, setLikelyLines] = useState<string[]>([]);
  const [structureCandidates, setStructureCandidates] = useState<string[]>([]);
  const [forcedLines, setForcedLines] = useState<Set<string>>(new Set());
  const [ignoredLines, setIgnoredLines] = useState<Set<string>>(new Set());
  const [roleInfo, setRoleInfo] = useState<{ profiles: Profile[]; mapping: Record<string, string> } | null>(null);
  const [descByRole, setDescByRole] = useState<Record<string, string>>({});
  const [descBusy, setDescBusy] = useState<Set<string>>(new Set());
  const [demoTextByRole, setDemoTextByRole] = useState<Record<string, string>>({});
  const [seedByRole, setSeedByRole] = useState<Record<string, { b64: string; refText: string; url: string; descUsed: string }>>({});
  const [descGen, setDescGen] = useState<{ total: number; done: number } | null>(null);
  const [seedGen, setSeedGen] = useState<{ total: number; done: number } | null>(null);
  const [genderSel, setGenderSel] = useState<Record<string, Gender>>({});
  const [ageSel, setAgeSel] = useState<Record<string, string>>({});
  const [edgeVoices, setEdgeVoices] = useState<Record<string, BaseVoiceInfo>>({});
  const [aiState, setAiState] = useState<"idle" | "running" | "done">("idle");
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [summary, setSummary] = useState<SynthSummary | null>(null);
  const [canEnter, setCanEnter] = useState(false);
  const [err, setErr] = useState("");
  const [eta, setEta] = useState(0);
  const [showLibrary, setShowLibrary] = useState(false);
  const [voiceTags, setVoiceTags] = useState<Record<string, VoiceTag>>(() => loadVoiceTags());
  const [voiceFilter, setVoiceFilter] = useState({ gender: "", age: "", dialect: "", special: "" });
  const [previewRole, setPreviewRole] = useState("");
  const [previewErr, setPreviewErr] = useState("");
  const [serviceOk, setServiceOk] = useState<boolean | null>(null);
  const [serviceBusy, setServiceBusy] = useState(false);
  const [archiveDir, setArchiveDir] = useState(loadArchiveDir);
  const [archiveOk, setArchiveOk] = useState<boolean | null>(null);
  const [dirOk, setDirOk] = useState<boolean | null>(null);
  const [seriesId, setSeriesId] = useState("");
  const [seriesName, setSeriesName] = useState("");
  const [bank, setBank] = useState<Record<string, VoiceBankEntry>>({});
  const [reusedRoles, setReusedRoles] = useState<Set<string>>(new Set());
  const [seedBusy, setSeedBusy] = useState<Set<string>>(new Set());
  const [refModalRole, setRefModalRole] = useState<string | null>(null);
  const [refFile, setRefFile] = useState<{ b64: string; url: string; name: string } | null>(null);
  const [refText, setRefText] = useState("");
  const [refBusy, setRefBusy] = useState(false);
  const [refErr, setRefErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const cardTopRef = useRef(0);
  const prevPhaseRef = useRef(phase);
  const t0Ref = useRef(0);
  const archiveAudioRef = useRef<Record<number, { durationMs: number }>>({});
  const metaSaveTimerRef = useRef<number | null>(null);
  const metaDirtyRef = useRef(false);
  const archiveCtxRef = useRef<ArchiveContext | null>(null);
  const refFileInputRef = useRef<HTMLInputElement | null>(null);
  const refFileAudioRef = useRef<HTMLAudioElement | null>(null);
  const refCloneAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let alive = true;
    archiveHealth().then((ok) => { if (alive) setArchiveOk(ok); });
    const timer = setInterval(() => {
      archiveHealth().then((ok) => { if (alive) setArchiveOk(ok); });
    }, 30000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  useEffect(() => {
    let alive = true;
    checkArchiveDir(archiveDir).then((ok) => { if (alive) setDirOk(ok); });
    return () => { alive = false; };
  }, [archiveDir]);

  useEffect(() => () => {
    if (metaSaveTimerRef.current) window.clearTimeout(metaSaveTimerRef.current);
  }, []);

  useEffect(() => {
    fetchEdgeVoices(edgeUrl).then(setEdgeVoices);
  }, [source, edgeUrl]);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      const url = source === "qwen" ? qwenUrl : edgeUrl;
      const ok = await checkHealth(url);
      let busy = false;
      if (ok && source === "qwen") {
        const st = await fetchTtsStatus(qwenUrl);
        const d = st?.design;
        const c = st?.clone;
        busy = !!(d?.busy && d.runningSec > 60) || !!(c?.busy && c.runningSec > 60);
      }
      if (alive) { setServiceOk(ok); setServiceBusy(busy); }
    };
    check();
    const timer = setInterval(check, 30000);
    return () => { alive = false; clearInterval(timer); };
  }, [source, edgeUrl, qwenUrl]);

  useEffect(() => {
    if (!showSettings) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShowSettings(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSettings]);

  useEffect(() => {
    if (phase === "upload" && cardRef.current) {
      cardTopRef.current = cardRef.current.getBoundingClientRect().top;
    }
    if (prevPhaseRef.current === "upload" && phase !== "upload") {
      const el = cardRef.current;
      if (el && cardTopRef.current) {
        const delta = cardTopRef.current - el.getBoundingClientRect().top;
        el.style.transition = "none";
        el.style.transform = "translateY(" + delta + "px)";
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            el.style.transition = "transform .6s cubic-bezier(.22, .8, .32, 1)";
            el.style.transform = "none";
          });
        });
      }
    }
    prevPhaseRef.current = phase;
  }, [phase]);

  const saveEdgeUrl = (v: string) => {
    setEdgeUrlState(v);
    persistEdgeUrl(v);
  };

  const saveQwenUrl = (v: string) => {
    setQwenUrlState(v);
    persistQwenUrl(v);
  };

  const pickDir = async () => {
    const dir = await pickArchiveDir();
    if (dir) {
      setArchiveDir(dir);
      saveArchiveDir(dir);
    }
  };

  const switchSource = (s: Source) => {
    saveSource(s);
    setSourceState(s);
    setUnits(null);
    setCharVoices([]);
    setProfiles([]);
    setGenderSel({});
    setPhase("upload");
    setStructureCandidates([]);
    setDescByRole({});
    setDescBusy(new Set());
    setDemoTextByRole({});
    setSeedByRole({});
    setDescGen(null);
    setSeedGen(null);
    setSummary(null);
    setCanEnter(false);
    setErr("");
  };

  const episodeNameFor = () => {
    if (fileName) return fileName.replace(/\.(docx|txt|md)$/i, "");
    const first = text.trim().split("\n")[0]?.slice(0, 24) || "剧本";
    return first;
  };

  const restoreSession = (ncv: CharacterVoice[]) => {
    if (segments && segments.length > 1 && segments[0]) {
      const s0 = segments[0];
      onAnalyzed({ text: s0.text, units: s0.units || [], charVoices: ncv, source });
    } else if (units) {
      onAnalyzed({ text, units, charVoices: ncv, source });
    }
  };

  const episodeIdFor = () => slugify(episodeNameFor());

  const ctxFor = (): ArchiveContext => ({
    dir: archiveDir,
    series: seriesId,
    seriesName,
    episode: episodeIdFor(),
    episodeName: episodeNameFor()
  });

  const saveStateOnly = (audio: Record<number, { durationMs: number }>) => {
    const eid = episodeIdFor();
    void saveMeta(archiveDir, seriesId, eid, { id: eid, name: episodeNameFor(), source, audio });
  };

  const flushMetaSoon = () => {
    metaDirtyRef.current = true;
    if (metaSaveTimerRef.current) return;
    metaSaveTimerRef.current = window.setTimeout(() => {
      metaSaveTimerRef.current = null;
      if (!metaDirtyRef.current) return;
      metaDirtyRef.current = false;
      saveStateOnly({ ...archiveAudioRef.current });
    }, 2000);
  };

  const b64ToBlob = (b64: string): Blob => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: "audio/wav" });
  };

  const bankEntryFor = (name: string): VoiceBankEntry | undefined => bank[roleBase(name)];

  const buildBankRoles = (vs: CharacterVoice[]): Record<string, VoiceBankEntry> => {
    const out: Record<string, VoiceBankEntry> = {};
    for (const cv of vs) {
      const key = roleBase(cv.name);
      out[key] = {
        canonical: key,
        variants: cv.merged && cv.merged.length ? cv.merged : [cv.name],
        gender: cv.gender,
        age: cv.age,
        source,
        voiceId: source === "edge" ? cv.voiceId : undefined,
        voiceDesc: cv.voiceDesc,
        seed: source === "qwen" ? "seeds/" + slugify(key) + ".wav" : undefined,
        refText: cv.cloneRefText,
        confirmedIn: episodeNameFor()
      };
    }
    return out;
  };

  const enterPlayer = () => {
    if (metaSaveTimerRef.current) {
      window.clearTimeout(metaSaveTimerRef.current);
      metaSaveTimerRef.current = null;
    }
    if (metaDirtyRef.current) {
      metaDirtyRef.current = false;
      const a = archiveAudioRef.current;
      const ctx = archiveCtxRef.current;
      if (a && Object.keys(a).length && ctx) saveStateOnly({ ...a });
    }
    onEnterPlayer();
  };

  const handleFiles = async (files: FileList | File[]) => {
    setErr("");
    const list = Array.from(files).filter((f) => /\.(docx|txt)$/i.test(f.name));
    if (!list.length) {
      setErr("未找到支持的剧本文件（.docx / .txt / .md）");
      return;
    }
    const candidates = list.map((f) => ({ file: f, ep: episodeFromName(f.name) }));
    candidates.sort(
      (a, b) => (a.ep ?? Number.MAX_SAFE_INTEGER) - (b.ep ?? Number.MAX_SAFE_INTEGER)
        || a.file.name.localeCompare(b.file.name, "zh-Hans-CN")
    );
    let lastEp = 0;
    const ordered = candidates.map((c) => {
      const episode = c.ep ?? lastEp + 1;
      lastEp = episode;
      return { file: c.file, episode };
    });
    const parts: string[] = [];
    const segs: Array<{ episode: number; text: string; name: string }> = [];
    const structCands: string[] = [];
    for (const { file: f, episode } of ordered) {
      try {
        if (f.name.toLowerCase().endsWith(".docx")) {
          const buf = await f.arrayBuffer();
          // 惰性加载 docx 相关依赖，避免 mammoth + jszip 进首屏
          const mammoth = (await import("mammoth/mammoth.browser.js")).default;
          const result = await mammoth.extractRawText({ arrayBuffer: buf });
          const v = (result.value || "").trim();
          if (!v) throw new Error(f.name + " 未提取到文本");
          parts.push(v);
          segs.push({ episode, text: v, name: f.name.replace(/\.(docx|txt|md)$/i, "") });
          const { extractSceneCandidates } = await import("../lib/docxMeta");
          structCands.push(...(await extractSceneCandidates(buf)));
        } else if (f.name.toLowerCase().endsWith(".txt") || f.name.toLowerCase().endsWith(".md")) {
          const v = (await f.text()).trim();
          parts.push(v);
          segs.push({ episode, text: v, name: f.name.replace(/\.(docx|txt|md)$/i, "") });
        }
      } catch (e) {
        setErr(f.name + " 读取失败: " + (e instanceof Error ? e.message : String(e)));
        return;
      }
    }
    const v = parts.filter(Boolean).join("\n\n").trim();
    if (!v) {
      setErr("所有文件都是空的，请检查内容");
      return;
    }
    setText(v);
    setSegments(segs);
    setStructureCandidates(Array.from(new Set(structCands)));
    setFileInfo(ordered.length + " 个文件 · 共 " + v.length + " 字");
    const fname = ordered[0]?.file.name || "";
    setFileName(fname);
    const sk = seriesKeyFromFile(fname) || "剧本";
    setSeriesName(sk);
    setSeriesId(slugify(sk));
    setBank({});
    setReusedRoles(new Set());
  };

  const assignVoicesFor = (ps: Profile[]): CharacterVoice[] => {
    const used = new Set<string>();
    used.add("zh-CN-XiaoxiaoNeural"); // 旁白固定占用晓晓原声
    return ps.map((p) => {
      if (p.name === "旁白") {
        return { name: p.name, voiceId: "zh-CN-XiaoxiaoNeural", gender: p.gender, age: p.age, lines: p.lines, merged: p.merged };
      }
      const entry = bankEntryFor(p.name);
      if (entry && entry.voiceId) {
        used.add(entry.voiceId);
        return { name: p.name, voiceId: entry.voiceId, gender: p.gender, age: p.age, lines: p.lines, merged: p.merged };
      }
      const voiceId = pickEdgeVoice(p, used);
      used.add(voiceId);
      return { name: p.name, voiceId, gender: p.gender, age: p.age, lines: p.lines, merged: p.merged };
    });
  };

  const pickEdgeVoice = (p: { name?: string; gender?: string; age?: string }, used: Set<string>): string => {
    const keys = Object.keys(edgeVoices).filter((k) => voiceTags[k]?.enabled !== false);
    const gender = p.gender === "男" ? "男" : p.gender === "女" ? "女" : "";
    const age = p.age || "";
    const findUnused = (pred: (t?: VoiceTag) => boolean, special?: boolean): string | null => {
      for (const k of keys) {
        if (used.has(k)) continue;
        const tag = voiceTags[k];
        if (special !== undefined && !!tag?.special !== special) continue;
        if (pred(tag)) return k;
      }
      return null;
    };
    const findAny = (pred: (t?: VoiceTag) => boolean): string | null => {
      for (const k of keys) {
        if (pred(voiceTags[k])) return k;
      }
      return null;
    };
    const exact = (t?: VoiceTag) => !!t && gender !== "" && t.gender === gender && t.age === age;
    const byGender = (t?: VoiceTag) => !!t && gender !== "" && t.gender === gender;

    let vid =
      findUnused(exact, false) ||
      findUnused(exact, true) ||
      findUnused(byGender, false) ||
      findUnused(byGender, true) ||
      findUnused(() => true, false) ||
      findUnused(() => true, true);
    if (!vid) {
      // 合适的未占用音色已经用完，允许重复，但优先挑最合适的
      vid =
        findAny(exact) ||
        findAny(byGender) ||
        findAny(() => true) ||
        defaultEdgeVoiceFor({ name: p.name || "", gender: gender || "女", age });
    }
    return vid;
  };

  const changeVoice = (name: string, newVoiceId: string) => {
    setCharVoices((cs) => cs.map((c) => (c.name === name ? { ...c, voiceId: newVoiceId } : c)));
  };

  const previewRoleVoice = async (cv: CharacterVoice) => {
    if (!cv.voiceId) return;
    const audio = previewAudioRef.current;
    if (!audio) return;
    if (previewRole === cv.name) {
      audio.pause();
      setPreviewRole("");
      return;
    }
    setPreviewErr("");
    try {
      const r = await edgeSynthOne(edgeUrl, "夜色渐深，街角的咖啡店还亮着灯。", cv.voiceId);
      if (audio.src.startsWith("blob:")) URL.revokeObjectURL(audio.src);
      audio.src = URL.createObjectURL(r.blob);
      setPreviewRole(cv.name);
      audio.play().catch(() => {});
    } catch (e) {
      setPreviewErr("试听失败: " + String(e));
    }
  };

  const runParse = (forced: Set<string>): Unit[] => {
    if (segments && segments.length) {
      let idStart = 0;
      let us: Unit[] = [];
      for (const seg of segments) {
        const segUnits = parseScript(seg.text, { episode: seg.episode, idStart, forcedSceneLines: forced });
        seg.units = segUnits.map((u) => ({
          ...u,
          id: u.id - idStart,
          group: u.group != null ? u.group - idStart : undefined
        }));
        us = us.concat(segUnits);
        idStart = us.length;
      }
      return us;
    }
    return parseScript(text, { forcedSceneLines: forced });
  };

  const buildFromUnits = (us: Unit[], baseProfiles: Profile[], mapping: Record<string, string>, bk: Record<string, VoiceBankEntry>) => {
    const us2 = us.map((u) => ({
      ...u,
      character: u.type === "narration" || u.type === "action" || u.type === "scene"
        ? "旁白"
        : (mapping[u.character] || u.character) || "旁白"
    }));
    const lines: Record<string, number> = {};
    for (const u of us2) {
      if (u.type === "dialogue") {
        lines[u.character] = (lines[u.character] || 0) + 1;
      } else if (u.character === "旁白") {
        lines["旁白"] = (lines["旁白"] || 0) + 1;
      }
    }
    const nextProfiles = baseProfiles.map((p) => ({ ...p, lines: lines[p.name] || 0 }));
    setUnits(us2);
    // 无种子(新角色)排前，可复用(有种子)排后，各自按台词数降序
    setProfiles(sortRolesForConfirm(nextProfiles, bk || {}));
  };

  /** 从角色 + 音色库一次性算性别/年龄预填：库里有的用库值，新角色用规则判断值 */
  const applyGenderAge = (ps: Profile[], bk: Record<string, VoiceBankEntry>) => {
    const gs: Record<string, Gender> = {};
    const as: Record<string, string> = {};
    for (const p of ps) {
      const e = bk[roleBase(p.name)];
      gs[p.name] = (e && e.gender) ? (e.gender as Gender) : (p.gender === "男" ? "男" : "女");
      as[p.name] = (e && e.age) ? e.age : (["少年", "青年", "中年", "老年"].includes(p.age || "") ? (p.age as string) : "中年");
    }
    setGenderSel(gs);
    setAgeSel(as);
  };

  const analyze = async () => {
    if (!text.trim()) { setErr("请先上传剧本"); return; }
    setErr("");
    setAiState("running");
    let us: Unit[];
    us = runParse(new Set());
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
        const dialogueContext = us
          .filter((u) => u.type === "dialogue")
          .map((u) => (u.character || "旁白") + "：" + u.text)
          .join("\n")
          .trim() || text;
        const llm = await analyzeRolesWithLLM(dsKey.trim(), rawNames, dialogueContext);
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
    setRoleInfo({ profiles, mapping });
    const ruleLikely = (segments && segments.length)
      ? Array.from(new Set(segments.flatMap((seg) => findLikelySceneLines(seg.text))))
      : findLikelySceneLines(text);
    const likely = Array.from(new Set([...ruleLikely, ...structureCandidates]));
    setLikelyLines(likely);
    setForcedLines(new Set());
    setIgnoredLines(new Set());
    setSeedByRole({});

    // 剧集音色库：识别剧名 → 载入已有音色 → 预填复用角色
    setBank({});
    setReusedRoles(new Set());
    let bankRoles: Record<string, VoiceBankEntry> = {};
    const archiveUpNow = archiveOk === true || await archiveHealth();
    setArchiveOk(archiveUpNow);
    const sk = seriesName || seriesKeyFromFile(fileName) || "剧本";
    const sid = slugify(sk);
    setSeriesName(sk);
    setSeriesId(sid);
    if (archiveUpNow) {
      try {
        const existing = (await listSeries(archiveDir)).find(
          (s) => (s.id === sid || s.name === sk) && s.source === source
        );
        const conflict = (await listSeries(archiveDir)).find((s) => (s.id === sid || s.name === sk) && s.source !== source);
        if (existing) {
          const vb = await loadVoiceBank(archiveDir, existing.id);
          bankRoles = vb.roles || {};
        }
        if (conflict && !existing) {
          setErr("该剧集已用 " + (conflict.source === "edge" ? "edge-tts" : "Qwen3") + " 音源建立，当前为" + (source === "edge" ? "edge-tts" : "Qwen3") + "，音色不再复用");
        }
      } catch { /* 音色库读不到就按新剧处理 */ }
    }
    setBank(bankRoles);
    const reused = new Set<string>();
    for (const p of profiles) {
      if (bankRoles[roleBase(p.name)]) reused.add(p.name);
    }
    setReusedRoles(reused);
    // qwen：复用既有种子，跳过重新生成
    if (source === "qwen" && archiveUpNow && sid) {
      const extra: Record<string, { b64: string; refText: string; url: string; descUsed: string }> = {};
      for (const p of profiles) {
        const e = bankRoles[roleBase(p.name)];
        if (!e || !e.seed || !e.refText) continue;
        const url = seedUrl(archiveDir, sid, e.canonical);
        try {
          const blob = await (await fetch(url)).blob();
          extra[p.name] = { b64: await blobToB64(blob), refText: e.refText, url, descUsed: e.voiceDesc || defaultVoiceDescFor(p) };
        } catch { /* 下载种子失败则走重新生成 */ }
      }
      if (Object.keys(extra).length) setSeedByRole((prev) => ({ ...prev, ...extra }));
    }

    buildFromUnits(us, profiles, mapping, bankRoles);
    // 性别/年龄预填：新角色用规则判断，复用角色用音色库
    applyGenderAge(profiles, bankRoles);
    setPhase("scenes");
    setAiState("done");
  };

  const toggleForcedScene = (line: string) => {
    const next = new Set(forcedLines);
    if (next.has(line)) next.delete(line);
    else next.add(line);
    setForcedLines(next);
    if (roleInfo) buildFromUnits(runParse(next), roleInfo.profiles, roleInfo.mapping, bank);
    if (roleInfo) applyGenderAge(roleInfo.profiles, bank);
  };

  const toggleIgnoredLine = (line: string) => {
    setIgnoredLines((prev) => {
      const next = new Set(prev);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });
  };

  const confirmGender = () => {
    const confirmed = profiles.map((p) => ({
      ...p,
      gender: (genderSel[p.name] === "男" ? "男" : "女") as Gender,
      age: ageSel[p.name] || p.age || "中年"
    }));
    setProfiles(confirmed);
    if (source === "qwen") {
      const descs: Record<string, string> = {};
      const demos: Record<string, string> = {};
      for (const p of confirmed) {
        descs[p.name] = seedByRole[p.name]?.descUsed || defaultVoiceDescFor(p);
        demos[p.name] = seedByRole[p.name]?.refText || firstLineFor(p.name);
      }
      setDescByRole(descs);
      setDemoTextByRole(demos);
      setPhase("design");
      if (aiEnabled && dsKey.trim()) generateAllDescs(confirmed.filter((p) => !reusedRoles.has(p.name)));
      return;
    }
    const ncv = assignVoicesFor(confirmed);
    setCharVoices(ncv);
    restoreSession(ncv);
    setPhase("voices");
  };

  const firstLineFor = (name: string): string => {
    const u = units?.find((x) => x.type === "dialogue" && x.character === name);
    return u ? u.text : "夜色渐深，街角的咖啡店还亮着灯。";
  };

  const generateDesc = async (p: Profile) => {
    const fallback = defaultVoiceDescFor(p);
    if (!dsKey.trim()) {
      setDescByRole((prev) => ({ ...prev, [p.name]: fallback }));
      return;
    }
    setDescBusy((prev) => new Set(prev).add(p.name));
    setErr("");
    try {
      const samples = (units || [])
        .filter((u) => u.type === "dialogue" && u.character === p.name)
        .slice(0, 3)
        .map((u) => u.text);
      const desc = await describeRoleVoice(dsKey.trim(), p, samples);
      setDescByRole((prev) => ({ ...prev, [p.name]: desc }));
    } catch {
      setErr("描述生成失败，已使用规则描述");
      setDescByRole((prev) => ({ ...prev, [p.name]: fallback }));
    } finally {
      setDescBusy((prev) => {
        const next = new Set(prev);
        next.delete(p.name);
        return next;
      });
    }
  };

  const generateAllDescs = async (ps: Profile[]) => {
    if (!dsKey.trim() || !aiEnabled) return;
    setDescGen({ total: ps.length, done: 0 });
    for (const p of ps) {
      setDescBusy((prev) => new Set(prev).add(p.name));
      try {
        const samples = (units || [])
          .filter((u) => u.type === "dialogue" && u.character === p.name)
          .slice(0, 3)
          .map((u) => u.text);
        const desc = await describeRoleVoice(dsKey.trim(), p, samples);
        setDescByRole((prev) => ({ ...prev, [p.name]: desc }));
      } catch {
        setDescByRole((prev) => ({ ...prev, [p.name]: defaultVoiceDescFor(p) }));
      } finally {
        setDescBusy((prev) => {
          const next = new Set(prev);
          next.delete(p.name);
          return next;
        });
        setDescGen((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
      }
    }
    setDescGen(null);
  };

  const blobToB64 = async (blob: Blob): Promise<string> => {
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
    }
    return btoa(binary);
  };

  const generateSeed = async (name: string, desc: string, text: string) => {
    const audio = previewAudioRef.current;
    if (!audio) return;
    const existing = seedByRole[name];
    if (existing && existing.descUsed === desc && previewRole === name) {
      audio.pause();
      setPreviewRole("");
      return;
    }
    if (existing && existing.descUsed === desc) {
      audio.src = existing.url;
      setPreviewRole(name);
      audio.play().catch(() => {});
      return;
    }
    if (previewRole === name) {
      audio.pause();
      setPreviewRole("");
      return;
    }
    setPreviewErr("");
    setSeedBusy((prev) => new Set(prev).add(name));
    try {
      const r = await qwenSynthOne(qwenUrl, text, desc || defaultVoiceDescFor({ name }));
      const b64 = await blobToB64(r.blob);
      const url = URL.createObjectURL(r.blob);
      if (audio.src.startsWith("blob:")) URL.revokeObjectURL(audio.src);
      setSeedByRole((prev) => ({ ...prev, [name]: { b64, refText: text, url, descUsed: desc } }));
      audio.src = url;
      setPreviewRole(name);
      audio.play().catch(() => {});
    } catch (e) {
      setPreviewErr("音色生成失败: " + String(e));
    } finally {
      setSeedBusy((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
    }
  };

  const openRefModal = (name: string) => {
    setRefModalRole(name);
    setRefFile(null);
    setRefText(seedByRole[name]?.descUsed === "参考音频" ? seedByRole[name].refText : "");
    setRefErr("");
    setRefBusy(false);
  };

  const closeRefModal = () => {
    setRefModalRole(null);
    if (refFile && refFile.url.startsWith("blob:")) URL.revokeObjectURL(refFile.url);
    setRefFile(null);
    setRefText("");
    setRefErr("");
    setRefBusy(false);
  };

  const onRefFile = async (file: File) => {
    setRefErr("");
    try {
      const raw = await file.arrayBuffer();
      const ctx = new AudioContext();
      let audio: AudioBuffer;
      try {
        audio = await ctx.decodeAudioData(raw);
      } finally {
        void ctx.close();
      }
      let mono = audio.getChannelData(0);
      if (audio.numberOfChannels > 1) {
        mono = new Float32Array(audio.length);
        for (let c = 0; c < audio.numberOfChannels; c++) {
          const d = audio.getChannelData(c);
          for (let i = 0; i < audio.length; i++) mono[i] += d[i] / audio.numberOfChannels;
        }
      }
      let sum = 0, peak = 0;
      for (let i = 0; i < mono.length; i++) {
        const v = mono[i];
        sum += v * v;
        const a = Math.abs(v);
        if (a > peak) peak = a;
      }
      const rms = Math.sqrt(sum / mono.length) || 1e-8;
      let gain = 0.1 / rms;
      if (peak * gain > 0.95) gain = 0.95 / (peak || 1);
      for (let i = 0; i < mono.length; i++) mono[i] *= gain;
      const wav = new Blob([encodeWav(mono, audio.sampleRate)], { type: "audio/wav" });
      const b64 = await blobToB64(wav);
      if (refFile && refFile.url.startsWith("blob:")) URL.revokeObjectURL(refFile.url);
      setRefFile({ b64, url: URL.createObjectURL(wav), name: file.name });
    } catch {
      setRefErr("无法解析该音频（格式不支持或文件损坏），请换 WAV / MP3 / M4A");
    }
  };

  const previewRefFile = () => {
    const a = refFileAudioRef.current;
    if (!a || !refFile) return;
    a.src = refFile.url;
    a.play().catch(() => {});
  };

  const previewRefClone = async (name: string) => {
    if (!refFile || !refText.trim()) { setRefErr("请先选择参考音频并填写参考文本"); return; }
    setRefBusy(true);
    setRefErr("");
    try {
      const demo = demoTextByRole[name] || firstLineFor(name);
      const r = await qwenCloneSynthOne(qwenUrl, demo, refFile.b64, refText.trim());
      const a = refCloneAudioRef.current;
      if (a) {
        if (a.src.startsWith("blob:")) URL.revokeObjectURL(a.src);
        a.src = URL.createObjectURL(r.blob);
        a.play().catch(() => {});
      }
    } catch (e) {
      setRefErr("试听克隆失败：" + String(e));
    } finally {
      setRefBusy(false);
    }
  };

  const applyRefSeed = (name: string) => {
    if (!refFile || !refText.trim()) { setRefErr("请先选择参考音频并填写参考文本"); return; }
    setSeedByRole((prev) => ({ ...prev, [name]: { b64: refFile.b64, refText: refText.trim(), url: refFile.url, descUsed: "参考音频" } }));
    closeRefModal();
  };

  const clearRefSeed = (name: string) => {
    setSeedByRole((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const confirmDesign = async () => {
    const seeds = { ...seedByRole };
    const missing = profiles.filter((p) => {
      const desc = descByRole[p.name] || defaultVoiceDescFor(p);
      const seed = seeds[p.name];
      return !(seed && (seed.descUsed === desc || seed.descUsed === "参考音频"));
    });
    if (missing.length) {
      setSeedGen({ total: missing.length, done: 0 });
      const worker = async () => {
        while (true) {
          const p = missing.pop();
          if (!p) break;
          const desc = descByRole[p.name] || defaultVoiceDescFor(p);
          const text = demoTextByRole[p.name] || firstLineFor(p.name);
          try {
            const r = await qwenSynthOne(qwenUrl, text, desc);
            const b64 = await blobToB64(r.blob);
            const url = URL.createObjectURL(r.blob);
            seeds[p.name] = { b64, refText: text, url, descUsed: desc };
            setSeedByRole((prev) => ({ ...prev, [p.name]: { b64, refText: text, url, descUsed: desc } }));
          } catch (e) {
            setErr("音色生成失败: " + String(e) + "（" + p.name + "）");
          } finally {
            setSeedGen((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
          }
        }
      };
      const workers = Array.from({ length: Math.min(3, missing.length) }, () => worker());
      await Promise.all(workers);
      setSeedGen(null);
    }
    const ncv: CharacterVoice[] = profiles.map((p) => {
      const seed = seeds[p.name];
      return {
        name: p.name,
        voiceId: p.name,
        gender: p.gender,
        age: p.age,
        lines: p.lines,
        voiceDesc: descByRole[p.name] || defaultVoiceDescFor(p),
        voiceMode: "clone",
        cloneAudioB64: seed?.b64,
        cloneRefText: seed?.refText
      };
    });
    setCharVoices(ncv);
    restoreSession(ncv);
    setPhase("voices");
  };

  const start = async () => {
    if (!units || !charVoices.length) return;
    onArchiveNew();
    const healthUrl = source === "qwen" ? qwenUrl : edgeUrl;
    if (!(await checkHealth(healthUrl))) {
      setErr(source === "qwen"
        ? "Qwen3 服务未启动，请先运行桌面快捷入口，或检查设置里的服务地址"
        : "edge-tts 服务未启动，请先运行桌面快捷入口，或检查设置里的服务地址");
      return;
    }
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
        : { name: n, voiceId: n, voiceDesc: defaultVoiceDescFor({ name: n }) }
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
    const buildSegUnits = (seg: EpisodeSegment): Unit[] => {
      if (seg.units && seg.units.length) return seg.units;
      return parseScript(seg.text, { episode: seg.episode, forcedSceneLines: forcedLines });
    };
    const projects = segments && segments.length > 1
      ? splitMultiEpisodeArchive(
          segments.map((seg) => ({ ...seg, units: buildSegUnits(seg) })),
          fullVoices,
          archiveDir,
          seriesId,
          seriesName
        )
      : [{ project: { scriptText: text, units: units || [], voices: fullVoices }, ctx: ctxFor() }];
    const project = projects[0].project;
    const archiveCtx = projects[0].ctx;

    let archiveInfo: ArchiveContext | null = null;
    let existingAudio: Record<number, { url: string; durationMs: number }> = {};
    archiveAudioRef.current = {};
    archiveCtxRef.current = null;
    const archiveUp = archiveOk === true || await archiveHealth();
    setArchiveOk(archiveUp);
    if (archiveUp) {
      archiveInfo = archiveCtx;
      archiveCtxRef.current = archiveCtx;
      project.archive = archiveCtx;
      onArchiveActive();
      for (const item of projects) {
        const order = item.project.units.find((u) => u.episode != null)?.episode ?? 1;
        await saveSeries(archiveDir, seriesId, seriesName, source, { id: item.ctx.episode, name: item.ctx.episodeName, order });
        await saveMeta(archiveDir, seriesId, item.ctx.episode, {
          id: item.ctx.episode,
          name: item.ctx.episodeName,
          source,
          scriptText: item.project.scriptText,
          units: item.project.units,
          voices: item.project.voices,
          audio: {}
        });
      }
      const meta = await loadMeta(archiveDir, seriesId, archiveCtx.episode);
      if (meta && meta.audio) {
        for (const [uid, a] of Object.entries(meta.audio)) {
          const n = Number(uid);
          existingAudio[n] = { url: archiveAudioUrl(archiveDir, seriesId, archiveCtx.episode, n), durationMs: a.durationMs };
          archiveAudioRef.current[n] = { durationMs: a.durationMs };
        }
      }
    }
    setProject(project);

    // 回写音色库：合并到整部剧音色库，保留前几集已有角色，本集确认/覆盖
    if (archiveUp) {
      const existingBank = await loadVoiceBank(archiveDir, seriesId);
      const merged = mergeVoiceBanks(existingBank.roles, buildBankRoles(fullVoices));
      await saveVoiceBank(archiveDir, seriesId, { roles: merged });
      if (source === "qwen") {
        for (const cv of fullVoices) {
          if (cv.cloneAudioB64 && cv.cloneRefText) {
            await saveSeed(archiveDir, seriesId, roleBase(cv.name), b64ToBlob(cv.cloneAudioB64));
          }
        }
      }
    }

    const specs: Record<string, VoiceSpec> = {};
    for (const cv of fullVoices) {
      if (cv.cloneAudioB64 && cv.cloneRefText) {
        specs[cv.name] = { kind: "clone", b64: cv.cloneAudioB64, refText: cv.cloneRefText };
      } else {
        specs[cv.name] = { kind: "desc", desc: cv.voiceDesc || defaultVoiceDescFor({ name: cv.name }) };
      }
    }
    voiceMapRef.current = specs;

    const stream = synthesizeStream(project, {
      firstBatchSize: 25,
      concurrency: source === "qwen" ? 2 : 3,
      onUnitReady: registerUnit,
      onProgress: (p) => {
        setProgress(p);
        if (p.done > 0 && p.total > 0) {
          const elapsed = (Date.now() - t0Ref.current) / 1000 / 60;
          setEta(Math.max(0, Math.round((elapsed / p.done) * (p.total - p.done))));
        }
      },
      existing: Object.keys(existingAudio).length ? existingAudio : undefined,
      synthFn: async (t, v, idx, unitId) => {
        if (unitId != null) {
          const claimed0 = regenClaimedRef.current.get(unitId);
          if (claimed0) return { blob: new Blob(), durationMs: claimed0.durationMs, url: claimed0.url };
        }
        const spec = voiceMapRef.current[v];
        const r = source === "qwen"
          ? (spec?.kind === "clone"
              ? await qwenCloneSynthOne(qwenUrl, t, spec.b64, spec.refText)
              : await qwenSynthOne(qwenUrl, t, spec?.kind === "desc" ? spec.desc : ""))
          : await edgeSynthOne(edgeUrl, t, v);
        if (unitId != null) {
          const claimed = regenClaimedRef.current.get(unitId);
          if (claimed) return { blob: new Blob(), durationMs: claimed.durationMs, url: claimed.url };
        }
        if (archiveInfo && unitId != null) {
          const ok = await saveAudio(archiveInfo.dir, archiveInfo.series, archiveInfo.episode, unitId, r.blob);
          if (ok) {
            archiveAudioRef.current[unitId] = { durationMs: r.durationMs };
            flushMetaSoon();
            return { ...r, url: archiveAudioUrl(archiveInfo.dir, archiveInfo.series, archiveInfo.episode, unitId) };
          }
        }
        return r;
      }
    });
    stream.firstReady.then(() => setCanEnter(true));
    stream.done.then((s) => {
      setSummary(s);
      setSyncing(false);
      if (archiveInfo) {
        if (metaSaveTimerRef.current) {
          window.clearTimeout(metaSaveTimerRef.current);
          metaSaveTimerRef.current = null;
        }
        saveStateOnly({ ...archiveAudioRef.current });
      }
      markSynthDone();
      if (archiveInfo && s.failed === 0) onFullReady?.(archiveInfo);
    });
  };

  const edgeCats: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(edgeVoices)) {
    (edgeCats[v.category] = edgeCats[v.category] || []).push(k);
  }
  const visibleEdgeKeys = Object.keys(edgeVoices).filter((key) => {
    const tag = voiceTags[key];
    if (!tag) return true;
    if (tag.enabled === false) return false;
    if (voiceFilter.gender && tag.gender !== voiceFilter.gender) return false;
    if (voiceFilter.age && tag.age !== voiceFilter.age) return false;
    if (voiceFilter.dialect === "none" && tag.dialect) return false;
    if (voiceFilter.dialect === "has" && !tag.dialect) return false;
    if (voiceFilter.special === "normal" && tag.special) return false;
    if (voiceFilter.special === "special" && !tag.special) return false;
    return true;
  });

  const voiceCounts: Record<string, number> = {};
  for (const cv of charVoices) {
    if (cv.voiceId) voiceCounts[cv.voiceId] = (voiceCounts[cv.voiceId] || 0) + 1;
  }
  const enabledVoiceCount = Object.keys(edgeVoices).filter((k) => voiceTags[k]?.enabled !== false).length;
  const sceneUnits = units ? units.filter((u) => u.type === "scene") : [];
  const sceneRaws = new Set(sceneUnits.map((u) => u.raw || u.text));
  const coveredByScene = (l: string) => {
    for (const s of sceneRaws) {
      if (s === l || s.startsWith(l + " ")) return true;
      const header = s.replace(/^\d{1,3}-\d{1,3}[A-Za-z]?\s+/, "");
      if (header === l || header.startsWith(l + " ")) return true;
    }
    return false;
  };
  const unrecognizedScenes = likelyLines.filter((l) => !sceneRaws.has(l) && !ignoredLines.has(l) && !coveredByScene(l));

  return (
    <div className={"work" + (phase === "upload" ? " upload-only" : "")}>
      <header className="topbar work-top">
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
              onChange={(e) => switchSource(e.target.value as Source)}
              title="声音来源"
            >
              <option value="qwen">Qwen3 1.7B</option>
              <option value="edge">edge-tts</option>
            </select>
          </div>
          {source === "edge" && <button className="top-chip" onClick={() => setShowLibrary(true)}>音色库</button>}
          <button className="top-chip" onClick={() => setShowSettings((v) => !v)}>设置</button>
        </div>
      </header>
      <div className={"work-grid solo" + (phase === "scenes" ? " scene-phase" : "")}>
        {phase === "upload" && (
        <section className="card" ref={cardRef}>
          <div className="upload-zone upload-hero" onClick={() => fileRef.current?.click()}>
            <div className="uz-icon">📄</div>
            <div className="uz-main">点击选择剧本文件</div>
            <div className="uz-sub">支持选择多个文件<br />文件格式支持.docx/.txt</div>
          </div>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".docx,.doc,.txt"
            style={{ display: "none" }}
            onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ""; }}
          />
          {fileInfo && <div className="file-info">✓ {fileInfo}</div>}
          <div className="upload-foot">
            <button onClick={analyze} className="primary big" disabled={aiState === "running"}>
              {aiState === "running" ? "解析中…" : (dsKey.trim() ? "AI解析剧本" : "解析剧本")}
            </button>
          </div>
        </section>
        )}

        {phase !== "upload" && (
        <>
          {phase === "gender" && units && (
            <section className="card flow-card">
              <h2>确认角色 · {profiles.length} 人</h2>
              {profiles.map((p) => (
                <div className="cv-row" key={p.name}>
                  <span className="cv-name">{p.name}</span>
                  {reusedRoles.has(p.name) && <span className="reuse-badge">已复用</span>}
                  {p.lines ? <span className="cv-tag">{p.lines} 句</span> : null}
                  <div className="cv-controls">
                    {p.merged && p.merged.length > 1 && (
                      <select className="variant-select" value="" onChange={() => {}} title={"角色写法 " + p.merged.length + " 种"}>
                        <option value="">多种表述</option>
                        {p.merged.filter((v) => v !== p.name).map((v) => <option key={v} value={v}>{v}</option>)}
                      </select>
                    )}
                    <div className="gender-pick">
                      {(["男", "女"] as const).map((g) => (
                        <button key={g} className={genderSel[p.name] === g ? "on" : ""} onClick={() => setGenderSel((s) => ({ ...s, [p.name]: g }))}>{g}</button>
                      ))}
                      <select className="age-select" value={ageSel[p.name] || "中年"} onChange={(e) => setAgeSel((s) => ({ ...s, [p.name]: e.target.value }))} title="年龄">
                        {["少年", "青年", "中年", "老年"].map((a) => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              ))}
              <button onClick={confirmGender} className="primary big">确认并分配音色</button>
            </section>
          )}

          {phase === "design" && units && (
            <section className="card flow-card">
              <h2>声音设计 · {profiles.length} 人</h2>
              {descGen && <div className="prog warn">AI 正在生成声音描述… {descGen.done}/{descGen.total}</div>}
              {previewErr && <div className="err">{previewErr}</div>}
              {err && <div className="err">{err}</div>}
              {profiles.map((p) => {
                const desc = descByRole[p.name] || defaultVoiceDescFor(p);
                const demo = demoTextByRole[p.name] || firstLineFor(p.name);
                return (
                  <div className="design-row" key={p.name}>
                    <div className="design-head">
                      <span className="cv-name">{p.name}</span>
                      {p.gender && (
                        <span className="cv-tag">
                          {p.gender}{p.age ? " · " + p.age : ""}{p.lines ? " · " + p.lines + " 句" : ""}
                        </span>
                      )}
                    </div>
                    <textarea
                      className="design-desc"
                      rows={2}
                      value={desc}
                      onChange={(e) => setDescByRole((prev) => ({ ...prev, [p.name]: e.target.value }))}
                    />
                    <div className="design-actions">
                      <input
                        value={demo}
                        onChange={(e) => setDemoTextByRole((prev) => ({ ...prev, [p.name]: e.target.value }))}
                      />
                      <button disabled={descBusy.has(p.name)} onClick={() => generateDesc(p)}>
                        {descBusy.has(p.name) ? "生成中…" : "AI 生成描述"}
                      </button>
                      <button disabled={seedBusy.has(p.name)} onClick={() => generateSeed(p.name, desc, demo)}>
                        {seedBusy.has(p.name) ? "生成中…" : (seedByRole[p.name] && seedByRole[p.name].descUsed === desc
                          ? (previewRole === p.name ? "停止" : "播放试听")
                          : "生成音色")}
                      </button>
                      <button className="secondary-pill" onClick={() => openRefModal(p.name)}>上传参考音频</button>
                      {seedByRole[p.name] && seedByRole[p.name].descUsed === desc && (
                        <span className="cv-tag">✓ 已生成固定音色</span>
                      )}
                      {seedByRole[p.name]?.descUsed === "参考音频" && (
                        <>
                          <span className="cv-tag">✓ 使用参考音频</span>
                          <button className="settings-link" onClick={() => clearRefSeed(p.name)}>清除参考</button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
              <button className="primary big" disabled={!!seedGen} onClick={confirmDesign}>
                {seedGen ? "生成固定音色中… " + seedGen.done + "/" + seedGen.total : "确认描述，进入角色与音色"}
              </button>
            </section>
          )}

          {phase === "scenes" && units && (
            <section className="card flow-card">
              <h2>场标预览 · {sceneUnits.length} 场</h2>
              {unrecognizedScenes.length > 0 && (
                <div className="prog warn">疑似场标 {unrecognizedScenes.length} 行未识别</div>
              )}
              {unrecognizedScenes.map((l) => (
                <div className="scene-suspect" key={l}>
                  <span className="scene-suspect-text">{l}</span>
                  <button onClick={() => toggleForcedScene(l)}>设为场标</button>
                  <button onClick={() => toggleIgnoredLine(l)}>忽略</button>
                </div>
              ))}
              <div className="scene-list">
                {sceneUnits.map((u) => (
                  <div className="scene-line" key={u.id}>
                    <span className="scene-line-no">{u.sceneNo}</span>
                    <span className="scene-line-text">{u.raw || u.text}</span>
                  </div>
                ))}
              </div>
              <button className="primary big" onClick={() => setPhase("gender")}>确认场标，进入角色确认</button>
            </section>
          )}

          {units && phase === "voices" && (
            <section className="card flow-card">
              <h2>角色与音色 · {units.length} 句</h2>
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
                  <select value={voiceFilter.special} onChange={(e) => setVoiceFilter((f) => ({ ...f, special: e.target.value }))}>
                    <option value="">通用+特殊</option>
                    <option value="normal">仅通用</option>
                    <option value="special">仅特殊</option>
                  </select>
                </div>
              )}
              {source === "edge" && charVoices.length > enabledVoiceCount && (
                <div className="prog warn">
                  可用音色 {enabledVoiceCount} 个，角色 {charVoices.length} 个，部分角色会重复。可到音色库启用更多档位。
                </div>
              )}
              {charVoices.map((cv) => (
                <div className={"cv-row" + (source === "edge" && !cv.voiceId ? " unassigned" : "")} key={cv.name}>
                  <div className="cv-left">
                    <span className="cv-name">{cv.name}</span>
                    {reusedRoles.has(cv.name) && <span className="reuse-badge">已复用</span>}
                    {cv.gender && (
                      <span className="cv-tag">
                        {cv.gender}{cv.age ? " · " + cv.age : ""}{cv.lines ? " · " + cv.lines + " 句" : ""}
                      </span>
                    )}
                    {cv.merged && cv.merged.length > 1 && (
                      <select className="variant-select" value="" onChange={() => {}} title={"角色写法 " + cv.merged.length + " 种"}>
                        <option value="">多种表述</option>
                        {cv.merged.filter((v) => v !== cv.name).map((v) => <option key={v} value={v}>{v}</option>)}
                      </select>
                    )}
                  </div>
                  {source === "edge" ? (
                    <>
                      <select value={cv.voiceId} onChange={(e) => changeVoice(cv.name, e.target.value)}>
                        <option value="">未分配</option>
                        {cv.voiceId && !visibleEdgeKeys.includes(cv.voiceId) && (
                          <option value={cv.voiceId}>
                            {tagLabelFor(cv.voiceId, edgeVoices[cv.voiceId]?.source_name || cv.voiceId, voiceTags)}（已停用）
                          </option>
                        )}
                        {Object.keys(edgeCats).length ? Object.entries(edgeCats).map(([cat, vids]) => (
                          <optgroup key={cat} label={cat}>
                            {vids.filter((vid) => visibleEdgeKeys.includes(vid)).map((vid) => (
                              <option key={vid} value={vid}>
                                {tagLabelFor(vid, edgeVoices[vid].source_name, voiceTags)}
                                {voiceCounts[vid] ? "（" + voiceCounts[vid] + "）" : ""}
                              </option>
                            ))}
                          </optgroup>
                        )) : <option value={cv.voiceId}>{cv.voiceId}</option>}
                      </select>
                      <button
                        className="cv-listen"
                        disabled={!cv.voiceId}
                        onClick={() => previewRoleVoice(cv)}
                      >
                        {previewRole === cv.name ? "停止" : "试听"}
                      </button>
                    </>
                  ) : (
                    <div className="cv-qwen-pick">
                      <span className="cv-desc-text">{cv.voiceDesc || "未填写声音描述"}</span>
                      <span className={"cv-tag" + (cv.cloneAudioB64 ? "" : " warn")}>
                        {cv.cloneAudioB64 ? "✓ 固定音色" : "未生成音色"}
                      </span>
                      <button className="cv-listen" onClick={() => setPhase("design")}>修改声音设计</button>
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
                  <button onClick={enterPlayer} className="primary">进入围读</button>
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
              {previewErr && <div className="err">{previewErr}</div>}
            </section>
          )}
        </>
        )}
      </div>

      {showLibrary && (
        <VoiceLibrary
          edgeUrl={edgeUrl}
          voices={edgeVoices}
          onTagsChange={(tags) => { setVoiceTags(tags); saveVoiceTags(tags); }}
          onClose={() => setShowLibrary(false)}
        />
      )}
      {showSettings && (
        <SettingsModal
          source={source}
          theme={theme}
          onTheme={onTheme}
          edgeUrl={edgeUrl}
          onEdgeUrl={(v) => { setEdgeUrlState(v); saveEdgeUrl(v); }}
          qwenUrl={qwenUrl}
          onQwenUrl={(v) => { setQwenUrlState(v); saveQwenUrl(v); }}
          dsKey={dsKey}
          onDsKey={(v) => { setDsKey(v); saveDsKey(v); }}
          archiveDir={archiveDir}
          dirOk={dirOk}
          onPickDir={pickDir}
          aiEnabled={aiEnabled}
          onAiEnabled={(v) => { setAiEnabled(v); saveAiEnabled(v); }}
          onClose={() => setShowSettings(false)}
        />
      )}
      {refModalRole && (
        <div className="modal-mask" onClick={closeRefModal}>
          <div className="modal settings-modal ref-modal" onClick={(e) => e.stopPropagation()}>
            <header className="lib-top">
              <span className="lib-title">上传参考音频 · {refModalRole}</span>
              <button className="lib-close" onClick={closeRefModal} aria-label="关闭">✕</button>
            </header>
            <div className="regen-body">
              <label className="regen-label">参考音频文件</label>
              <div className="ref-file-row">
                <button className="secondary-pill" onClick={() => refFileInputRef.current?.click()}>
                  选择音频文件
                </button>
                {refFile && (
                  <>
                    <span className="cv-tag ref-file-name">{refFile.name}</span>
                    <button className="secondary-pill" onClick={previewRefFile}>试听原音频</button>
                  </>
                )}
                <input
                  ref={refFileInputRef}
                  type="file"
                  accept="audio/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files && e.target.files[0];
                    if (f) void onRefFile(f);
                  }}
                />
              </div>
              <label className="regen-label">参考文本</label>
              <input
                value={refText}
                onChange={(e) => setRefText(e.target.value)}
                placeholder="这段音频说了什么"
              />
              <p className="regen-hint">建议 5–15 秒干净人声；参考文本需与音频内容一致，否则克隆会漂。</p>
              <div className="regen-actions">
                <button
                  className="secondary-pill"
                  disabled={refBusy || !refFile || !refText.trim()}
                  onClick={() => previewRefClone(refModalRole)}
                >
                  {refBusy ? "克隆中…" : "试听克隆"}
                </button>
                <button
                  className="primary"
                  disabled={refBusy || !refFile || !refText.trim()}
                  onClick={() => applyRefSeed(refModalRole)}
                >
                  设为该角色音色
                </button>
              </div>
              {refErr && <div className="err">{refErr}</div>}
            </div>
            <audio ref={refFileAudioRef} />
            <audio ref={refCloneAudioRef} />
          </div>
        </div>
      )}
      <audio ref={previewAudioRef} onEnded={() => setPreviewRole("")} />
    </div>
  );
}
