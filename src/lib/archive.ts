import type { CharacterVoice, Unit } from "./types";

export interface EpisodeRef {
  id: string;
  name: string;
  order: number;
  full?: boolean;
}

export interface SeriesListItem {
  id: string;
  name: string;
  source: "edge" | "qwen";
  updatedAt: string;
  episodes: number;
  voices: number;
}

export interface EpisodeMeta {
  id: string;
  name: string;
  source: "edge" | "qwen";
  scriptText: string;
  units: Unit[];
  voices: CharacterVoice[];
  audio: Record<string, { durationMs: number }>;
  playback?: { currentIdx: number; globalMs: number; rate?: number };
  updatedAt?: string;
}

export interface VoiceBankEntry {
  canonical: string;
  variants: string[];
  gender?: string;
  age?: string;
  source: "edge" | "qwen";
  voiceId?: string; // edge
  voiceDesc?: string; // qwen
  seed?: string; // qwen 种子路径(相对 音色/)
  refText?: string; // qwen
  confirmedIn?: string;
}

export interface VoiceBank {
  updatedAt?: string;
  roles: Record<string, VoiceBankEntry>;
}

export interface FullAudioInfo {
  exists: boolean;
  path?: string;
  durationMs?: number;
  complete?: boolean;
  stale?: boolean;
  missing?: number;
}

export interface StitchResult {
  ok: boolean;
  durationMs?: number;
  units?: number;
  missing?: number;
  path?: string;
  error?: string;
}

const BASE = "http://127.0.0.1:9884";
const enc = (s: string) => encodeURIComponent(s);

export async function archiveHealth(): Promise<boolean> {
  try {
    const r = await fetch(BASE + "/health");
    return r.ok;
  } catch {
    return false;
  }
}

export async function checkArchiveDir(dir: string): Promise<boolean | null> {
  try {
    const r = await fetch(BASE + "/check-dir?dir=" + enc(dir));
    if (!r.ok) return null;
    const j = await r.json();
    return typeof j.ok === "boolean" ? j.ok : null;
  } catch {
    return null;
  }
}

export async function pickArchiveDir(): Promise<string | null> {
  try {
    const r = await fetch(BASE + "/pick-dir", { method: "POST" });
    if (!r.ok) return null;
    const j = await r.json();
    return j.ok && j.dir ? j.dir : null;
  } catch {
    return null;
  }
}

export async function revealDir(dir: string): Promise<boolean> {
  try {
    const r = await fetch(BASE + "/reveal-dir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dir })
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function listSeries(dir: string): Promise<SeriesListItem[]> {
  try {
    const r = await fetch(BASE + "/list-series?dir=" + enc(dir));
    if (!r.ok) return [];
    const j = await r.json();
    return (j.series || []) as SeriesListItem[];
  } catch {
    return [];
  }
}

export async function saveSeries(
  dir: string,
  id: string,
  name: string,
  source: "edge" | "qwen",
  episode?: EpisodeRef
): Promise<boolean> {
  try {
    const r = await fetch(BASE + "/series", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dir, id, name, source, episode })
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function listEpisodes(dir: string, seriesId: string): Promise<EpisodeRef[]> {
  try {
    const r = await fetch(BASE + "/episodes?dir=" + enc(dir) + "&series=" + enc(seriesId));
    if (!r.ok) return [];
    const j = await r.json();
    return (j.episodes || []) as EpisodeRef[];
  } catch {
    return [];
  }
}

export async function loadMeta(dir: string, seriesId: string, episodeId: string): Promise<EpisodeMeta | null> {
  try {
    const r = await fetch(BASE + "/meta?dir=" + enc(dir) + "&series=" + enc(seriesId) + "&id=" + enc(episodeId));
    if (!r.ok) return null;
    const j = await r.json();
    return (j.meta as EpisodeMeta) || null;
  } catch {
    return null;
  }
}

export async function saveMeta(dir: string, seriesId: string, episodeId: string, meta: Partial<EpisodeMeta>): Promise<boolean> {
  try {
    const r = await fetch(BASE + "/meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dir, series: seriesId, id: episodeId, meta })
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function saveAudio(dir: string, seriesId: string, episodeId: string, unitId: number, blob: Blob): Promise<boolean> {
  try {
    const r = await fetch(BASE + "/audio?dir=" + enc(dir) + "&series=" + enc(seriesId) + "&id=" + enc(episodeId) + "&unit=" + unitId, {
      method: "POST",
      body: blob
    });
    return r.ok;
  } catch {
    return false;
  }
}

export function archiveAudioUrl(dir: string, seriesId: string, episodeId: string, unitId: number): string {
  return BASE + "/audio?dir=" + enc(dir) + "&series=" + enc(seriesId) + "&id=" + enc(episodeId) + "&unit=" + unitId;
}

/**
 * 合并整部剧的音色库：保留前几集已有角色，用本集角色覆盖同名项。
 * 纯函数，便于单元测试（防止回退成"整库替换"导致跨集角色丢失）。
 */
export function mergeVoiceBanks(
  base: Record<string, VoiceBankEntry>,
  incoming: Record<string, VoiceBankEntry>
): Record<string, VoiceBankEntry> {
  return { ...base, ...incoming };
}

export async function savePlayback(dir: string, seriesId: string, episodeId: string, currentIdx: number, globalMs: number, rate = 1): Promise<void> {
  try {
    await fetch(BASE + "/playback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dir, series: seriesId, id: episodeId, currentIdx, globalMs, rate })
    });
  } catch {
    /* 存档服务不可用时静默 */
  }
}

export async function loadVoiceBank(dir: string, seriesId: string): Promise<VoiceBank> {
  try {
    const r = await fetch(BASE + "/voicebank?dir=" + enc(dir) + "&series=" + enc(seriesId));
    if (!r.ok) return { roles: {} };
    const j = await r.json();
    return j.bank || { roles: {} };
  } catch {
    return { roles: {} };
  }
}

export async function saveVoiceBank(dir: string, seriesId: string, bank: VoiceBank): Promise<boolean> {
  try {
    const r = await fetch(BASE + "/voicebank", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dir, series: seriesId, bank })
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function saveSeed(dir: string, seriesId: string, role: string, blob: Blob): Promise<boolean> {
  try {
    const r = await fetch(BASE + "/seed?dir=" + enc(dir) + "&series=" + enc(seriesId) + "&role=" + enc(role), {
      method: "POST",
      body: blob
    });
    return r.ok;
  } catch {
    return false;
  }
}

export function seedUrl(dir: string, seriesId: string, role: string): string {
  return BASE + "/seed?dir=" + enc(dir) + "&series=" + enc(seriesId) + "&role=" + enc(role);
}

export async function fullAudioInfo(dir: string, seriesId: string, episodeId: string): Promise<FullAudioInfo | null> {
  try {
    const r = await fetch(BASE + "/full-audio-info?dir=" + enc(dir) + "&series=" + enc(seriesId) + "&id=" + enc(episodeId));
    if (!r.ok) return null;
    const j = await r.json();
    return j as FullAudioInfo;
  } catch {
    return null;
  }
}

export async function stitchAudio(dir: string, seriesId: string, episodeId: string): Promise<StitchResult | null> {
  try {
    const r = await fetch(BASE + "/stitch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dir, series: seriesId, id: episodeId })
    });
    const j = await r.json().catch(() => ({}));
    return (j as StitchResult) || null;
  } catch {
    return null;
  }
}

export async function revealFullAudio(dir: string, seriesId: string, episodeId: string): Promise<boolean> {
  try {
    const r = await fetch(BASE + "/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dir, series: seriesId, id: episodeId })
    });
    const j = await r.json().catch(() => ({}));
    return !!(j && j.ok);
  } catch {
    return false;
  }
}

export function fullAudioUrl(dir: string, seriesId: string, episodeId: string): string {
  return BASE + "/full-audio?dir=" + enc(dir) + "&series=" + enc(seriesId) + "&id=" + enc(episodeId);
}

export async function deleteSeries(dir: string, seriesId: string): Promise<boolean> {
  try {
    const r = await fetch(BASE + "/delete-series", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dir, series: seriesId })
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function deleteEpisode(dir: string, seriesId: string, episodeId: string): Promise<boolean> {
  try {
    const r = await fetch(BASE + "/delete-episode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dir, series: seriesId, id: episodeId })
    });
    return r.ok;
  } catch {
    return false;
  }
}
