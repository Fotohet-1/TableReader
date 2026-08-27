import { useEffect, useRef, useState } from "react";
import type { CharacterVoice, Project, Session, Unit, UnitAudio } from "../lib/types";
import { parseScript, collectCharacters, episodeFromName, findLikelySceneLines } from "../lib/parser";
import { extractSceneCandidates } from "../lib/docxMeta";
import { groupRoles } from "../lib/roles";
import { guessGender, defaultEdgeVoiceFor, defaultVoiceDescFor } from "../lib/voices";
import { analyzeRolesWithLLM, describeRoleVoice } from "../lib/llm";
import { synthesizeStream, type Progress, type SynthSummary } from "../lib/synth";
import {
  checkHealth,
  edgeSynthOne,
  fetchEdgeVoices,
  qwenCloneSynthOne,
  qwenSynthOne,
  type BaseVoiceInfo
} from "../lib/tts";
import mammoth from "mammoth/mammoth.browser.js";
import VoiceLibrary from "../components/VoiceLibrary";
import {
  loadVoiceTags,
  saveVoiceTags,
  tagLabelFor,
  type VoiceTag
} from "../lib/voiceTags";
import {
  clearOnboarded,
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
import {
  archiveAudioUrl,
  archiveHealth,
  loadMeta,
  saveAudio,
  saveMeta,
  type ArchiveMeta
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

export default function UploadPage({ lastSession, onAnalyzed, resetItems, registerUnit, markSynthDone, setProject, onArchiveNew, onArchiveActive, onEnterPlayer, onBack }: {
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
  const [segments, setSegments] = useState<Array<{ episode: number; text: string }> | null>(null);
  const [units, setUnits] = useState<Unit[] | null>(() => (lastSession && lastSession.source === source ? lastSession.units : null));
  const [charVoices, setCharVoices] = useState<CharacterVoice[]>(() => (lastSession && lastSession.source === source ? lastSession.charVoices : []));
  const [phase, setPhase] = useState<"upload" | "scenes" | "gender" | "design" | "voices">("upload");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [likelyLines, setLikelyLines] = useState<string[]>([]);
  const [structureCandidates, setStructureCandidates] = useState<string[]>([]);
  const [forcedLines, setForcedLines] = useState<Set<string>>(new Set());
  const [ignoredLines, setIgnoredLines] = useState<Set<string>>(new Set());
  const [roleBase, setRoleBase] = useState<{ profiles: Profile[]; mapping: Record<string, string> } | null>(null);
  const [descByRole, setDescByRole] = useState<Record<string, string>>({});
  const [descBusy, setDescBusy] = useState<Set<string>>(new Set());
  const [demoTextByRole, setDemoTextByRole] = useState<Record<string, string>>({});
  const [seedByRole, setSeedByRole] = useState<Record<string, { b64: string; refText: string; url: string; descUsed: string }>>({});
  const [descGen, setDescGen] = useState<{ total: number; done: number } | null>(null);
  const [seedGen, setSeedGen] = useState<{ total: number; done: number } | null>(null);
  const [genderSel, setGenderSel] = useState<Record<string, Gender>>({});
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
  const [archiveDir, setArchiveDir] = useState(loadArchiveDir);
  const [archiveOk, setArchiveOk] = useState<boolean | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const cardTopRef = useRef(0);
  const prevPhaseRef = useRef(phase);
  const t0Ref = useRef(0);
  const archiveAudioRef = useRef<Record<number, { durationMs: number }>>({});
  const metaSaveTimerRef = useRef<number | null>(null);
  const metaDirtyRef = useRef(false);
  const archiveCtxRef = useRef<{ dir: string; id: string; name: string } | null>(null);

  useEffect(() => {
    let alive = true;
    archiveHealth().then((ok) => { if (alive) setArchiveOk(ok); });
    const timer = setInterval(() => {
      archiveHealth().then((ok) => { if (alive) setArchiveOk(ok); });
    }, 30000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

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
      if (alive) setServiceOk(ok);
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

  const saveProjectBase = (dir: string, id: string, name: string) => {
    const meta: Partial<ArchiveMeta> = {
      id,
      name,
      source,
      scriptText: text,
      units: units || [],
      voices: charVoices,
      audio: {}
    };
    void saveMeta(dir, id, meta);
  };

  const saveStateOnly = (dir: string, id: string, name: string, audio: Record<number, { durationMs: number }>) => {
    void saveMeta(dir, id, { id, name, source, audio });
  };

  const flushMetaSoon = (dir: string, id: string, name: string) => {
    metaDirtyRef.current = true;
    if (metaSaveTimerRef.current) return;
    metaSaveTimerRef.current = window.setTimeout(() => {
      metaSaveTimerRef.current = null;
      if (!metaDirtyRef.current) return;
      metaDirtyRef.current = false;
      saveStateOnly(dir, id, name, { ...archiveAudioRef.current });
    }, 2000);
  };

  const projectNameFor = () => {
    if (fileName) {
      const base = fileName.replace(/\.(docx|txt|md)$/i, "");
      return segments && segments.length > 1 ? base + "（" + segments.length + "集）" : base;
    }
    const first = text.trim().split("\n")[0]?.slice(0, 24) || "剧本";
    return first;
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
      if (a && Object.keys(a).length && ctx) saveStateOnly(ctx.dir, ctx.id, ctx.name, { ...a });
    }
    onEnterPlayer();
  };

  const handleFiles = async (files: FileList | File[]) => {
    setErr("");
    const list = Array.from(files).filter((f) => /\.(docx|txt|md)$/i.test(f.name));
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
    const segs: Array<{ episode: number; text: string }> = [];
    const structCands: string[] = [];
    for (const { file: f, episode } of ordered) {
      try {
        if (f.name.toLowerCase().endsWith(".docx")) {
          const buf = await f.arrayBuffer();
          const result = await mammoth.extractRawText({ arrayBuffer: buf });
          const v = (result.value || "").trim();
          if (!v) throw new Error(f.name + " 未提取到文本");
          parts.push(v);
          segs.push({ episode, text: v });
          structCands.push(...(await extractSceneCandidates(buf)));
        } else if (f.name.toLowerCase().endsWith(".txt") || f.name.toLowerCase().endsWith(".md")) {
          const v = (await f.text()).trim();
          parts.push(v);
          segs.push({ episode, text: v });
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
    setFileName(ordered[0]?.file.name || "");
  };

  const assignVoicesFor = (ps: Profile[]): CharacterVoice[] => {
    const used = new Set<string>();
    used.add("zh-CN-XiaoxiaoNeural"); // 旁白固定占用晓晓原声
    return ps.map((p) => {
      if (p.name === "旁白") {
        return { name: p.name, voiceId: "zh-CN-XiaoxiaoNeural", gender: p.gender, age: p.age, lines: p.lines };
      }
      const voiceId = pickEdgeVoice(p, used);
      used.add(voiceId);
      return { name: p.name, voiceId, gender: p.gender, age: p.age, lines: p.lines };
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
        us = us.concat(parseScript(seg.text, { episode: seg.episode, idStart, forcedSceneLines: forced }));
        idStart = us.length;
      }
      return us;
    }
    return parseScript(text, { forcedSceneLines: forced });
  };

  const buildFromUnits = (us: Unit[], baseProfiles: Profile[], mapping: Record<string, string>) => {
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
    nextProfiles.sort((a, b) => (b.lines || 0) - (a.lines || 0) || a.name.localeCompare(b.name, "zh-Hans-CN"));
    setUnits(us2);
    setProfiles(nextProfiles);
    setGenderSel(Object.fromEntries(nextProfiles.map((p) => [p.name, p.gender])));
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
    setRoleBase({ profiles, mapping });
    const ruleLikely = (segments && segments.length)
      ? Array.from(new Set(segments.flatMap((seg) => findLikelySceneLines(seg.text))))
      : findLikelySceneLines(text);
    const likely = Array.from(new Set([...ruleLikely, ...structureCandidates]));
    setLikelyLines(likely);
    setForcedLines(new Set());
    setIgnoredLines(new Set());
    setSeedByRole({});
    buildFromUnits(us, profiles, mapping);
    setPhase("scenes");
    setAiState("done");
  };

  const toggleForcedScene = (line: string) => {
    const next = new Set(forcedLines);
    if (next.has(line)) next.delete(line);
    else next.add(line);
    setForcedLines(next);
    if (roleBase) buildFromUnits(runParse(next), roleBase.profiles, roleBase.mapping);
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
    const confirmed = profiles.map((p) => ({ ...p, gender: genderSel[p.name] || p.gender }));
    setProfiles(confirmed);
    if (source === "qwen") {
      const descs: Record<string, string> = {};
      const demos: Record<string, string> = {};
      for (const p of confirmed) {
        descs[p.name] = defaultVoiceDescFor(p);
        demos[p.name] = firstLineFor(p.name);
      }
      setDescByRole(descs);
      setDemoTextByRole(demos);
      setPhase("design");
      if (aiEnabled && dsKey.trim()) generateAllDescs(confirmed);
      return;
    }
    const ncv = assignVoicesFor(confirmed);
    setCharVoices(ncv);
    if (units) onAnalyzed({ text, units, charVoices: ncv, source });
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
    }
  };

  const confirmDesign = async () => {
    const seeds = { ...seedByRole };
    const missing = profiles.filter((p) => {
      const desc = descByRole[p.name] || defaultVoiceDescFor(p);
      const seed = seeds[p.name];
      return !(seed && seed.descUsed === desc);
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
            setSeedByRole(seeds);
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
    if (units) onAnalyzed({ text, units, charVoices: ncv, source });
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
    const project: Project = { scriptText: text, units, voices: fullVoices };

    let archiveInfo: { dir: string; id: string; name: string } | null = null;
    let existingAudio: Record<number, { url: string; durationMs: number }> = {};
    archiveAudioRef.current = {};
    archiveCtxRef.current = null;
    const archiveUp = archiveOk === true || await archiveHealth();
    setArchiveOk(archiveUp);
    if (archiveUp) {
      const id = "sr-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
      const name = projectNameFor();
      archiveInfo = { dir: archiveDir, id, name };
      archiveCtxRef.current = archiveInfo;
      project.archive = archiveInfo;
      onArchiveActive();
      saveProjectBase(archiveDir, id, name);
      const meta = await loadMeta(archiveDir, id);
      if (meta && meta.audio) {
        for (const [uid, a] of Object.entries(meta.audio)) {
          const n = Number(uid);
          existingAudio[n] = { url: archiveAudioUrl(archiveDir, id, n), durationMs: a.durationMs };
          archiveAudioRef.current[n] = { durationMs: a.durationMs };
        }
      }
    }
    setProject(project);

    const descMap: Record<string, string> = {};
    const cloneMap: Record<string, { b64: string; refText: string }> = {};
    for (const cv of fullVoices) {
      if (cv.voiceDesc) descMap[cv.name] = cv.voiceDesc;
      if (cv.cloneAudioB64 && cv.cloneRefText) cloneMap[cv.name] = { b64: cv.cloneAudioB64, refText: cv.cloneRefText };
    }

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
        const r = source === "qwen"
          ? (cloneMap[v]
              ? await qwenCloneSynthOne(qwenUrl, t, cloneMap[v].b64, cloneMap[v].refText)
              : await qwenSynthOne(qwenUrl, t, descMap[v] || ""))
          : await edgeSynthOne(edgeUrl, t, v);
        if (archiveInfo && unitId != null) {
          const ok = await saveAudio(archiveInfo.dir, archiveInfo.id, unitId, r.blob);
          if (ok) {
            archiveAudioRef.current[unitId] = { durationMs: r.durationMs };
            flushMetaSoon(archiveInfo.dir, archiveInfo.id, archiveInfo.name);
            return { ...r, url: archiveAudioUrl(archiveInfo.dir, archiveInfo.id, unitId) };
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
        saveStateOnly(archiveInfo.dir, archiveInfo.id, archiveInfo.name, { ...archiveAudioRef.current });
      }
      markSynthDone();
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
  const unrecognizedScenes = likelyLines.filter((l) => !sceneRaws.has(l) && !ignoredLines.has(l));

  return (
    <div className={"work" + (phase === "upload" ? " upload-only" : "")}>
      <button className="work-back" onClick={onBack}>← 返回</button>
      <div className="work-grid solo">
        <section className="card" ref={cardRef}>
          <div className="upload-zone upload-hero" onClick={() => fileRef.current?.click()}>
            <div className="uz-icon">📄</div>
            <div className="uz-main">点击选择剧本文件</div>
            <div className="uz-sub">可多选；文件夹里的文件全选后一起导入（.docx / .txt）</div>
          </div>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".docx,.doc,.txt,.md"
            style={{ display: "none" }}
            onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ""; }}
          />
          {fileInfo && <div className="file-info">✓ {fileInfo}</div>}
          <div className="upload-foot">
            <button onClick={analyze} className="primary big" disabled={aiState === "running"}>
              {aiState === "running" ? "解析中…" : "解析剧本"}
            </button>
          </div>
          <div className="upload-options">
            <select
              className="source-select"
              value={source}
              onChange={(e) => switchSource(e.target.value as Source)}
              title="声音来源"
            >
              <option value="qwen">Qwen3 1.7B</option>
              <option value="edge">edge-tts</option>
            </select>
            <span
              className={"svc-dot " + (serviceOk === null ? "unknown" : serviceOk ? "ok" : "down")}
              title={source === "qwen" ? ("Qwen3 " + qwenUrl) : ("edge-tts " + edgeUrl)}
            />
            {source === "edge" && <button className="lib-entry" onClick={() => setShowLibrary(true)}>音色库</button>}
            <button className="lib-entry" onClick={() => setShowSettings((v) => !v)}>设置</button>
          </div>
        </section>

        {phase !== "upload" && (
        <>
          {phase === "gender" && units && (
            <section className="card flow-card">
              <h2>确认角色性别 · {profiles.length} 人</h2>
              {profiles.map((p) => (
                <div className="cv-row" key={p.name}>
                  <span className="cv-name">{p.name}</span>
                  {p.lines ? <span className="cv-tag">{p.lines} 句</span> : null}
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

          {phase === "design" && units && (
            <section className="card flow-card">
              <h2>声音设计 · {profiles.length} 人</h2>
              {descGen && <div className="prog warn">AI 正在生成声音描述… {descGen.done}/{descGen.total}</div>}
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
                      <button onClick={() => generateSeed(p.name, desc, demo)}>
                        {seedByRole[p.name] && seedByRole[p.name].descUsed === desc
                          ? (previewRole === p.name ? "停止" : "播放试听")
                          : "生成音色"}
                      </button>
                      {seedByRole[p.name] && seedByRole[p.name].descUsed === desc && (
                        <span className="cv-tag">✓ 已生成固定音色</span>
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
                    {cv.gender && (
                      <span className="cv-tag">
                        {cv.gender}{cv.age ? " · " + cv.age : ""}{cv.lines ? " · " + cv.lines + " 句" : ""}
                      </span>
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
        <div className="modal-mask" onClick={() => setShowSettings(false)}>
          <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
            <header className="lib-top">
              <span className="lib-title">设置</span>
              <button className="lib-close" onClick={() => setShowSettings(false)} aria-label="关闭">✕</button>
            </header>
            <div className="settings-body">
              {source === "edge" ? (
                <div className="field">
                  <label>edge-tts 地址</label>
                  <input value={edgeUrl} onChange={(e) => saveEdgeUrl(e.target.value)} />
                </div>
              ) : (
                <div className="field">
                  <label>Qwen3 地址</label>
                  <input value={qwenUrl} onChange={(e) => saveQwenUrl(e.target.value)} />
                </div>
              )}
              <div className="field">
                <label>DeepSeek Key</label>
                <input value={dsKey} onChange={(e) => { setDsKey(e.target.value); saveDsKey(e.target.value); }} placeholder="可选" />
              </div>
              <div className="field">
                <label>存档目录</label>
                <input
                  value={archiveDir}
                  onChange={(e) => { setArchiveDir(e.target.value); saveArchiveDir(e.target.value); }}
                  placeholder="~/Documents/剧本围读存档"
                />
                <span
                  className={"svc-dot " + (archiveOk === null ? "unknown" : archiveOk ? "ok" : "down")}
                  title={"存档服务 " + (archiveOk === null ? "检测中" : archiveOk ? "正常" : "未启动")}
                />
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={aiEnabled}
                  onChange={(e) => { setAiEnabled(e.target.checked); saveAiEnabled(e.target.checked); }}
                />
                DeepSeek 角色分析
              </label>
              <p className="settings-hint">Key 仅保存在本机浏览器</p>
              <div className="row">
                <button className="settings-link" onClick={() => { setDsKey(""); saveDsKey(""); }}>清除 Key</button>
                <button className="settings-link" onClick={() => { clearOnboarded(); window.location.reload(); }}>重新查看引导</button>
              </div>
            </div>
          </div>
        </div>
      )}
      <audio ref={previewAudioRef} onEnded={() => setPreviewRole("")} />
    </div>
  );
}
