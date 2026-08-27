import type { CharacterVoice, Unit } from "./types";

export interface ArchiveMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  source: "edge" | "qwen";
  scriptText: string;
  units: Unit[];
  voices: CharacterVoice[];
  audio: Record<string, { durationMs: number }>;
  playback: { currentIdx: number; globalMs: number; rate?: number };
}

const BASE = "http://127.0.0.1:9884";

export interface ArchiveProject {
  id: string;
  name: string;
  updatedAt: string;
  units?: number;
  audio?: number;
}

export async function archiveHealth(): Promise<boolean> {
  try {
    const r = await fetch(BASE + "/health");
    return r.ok;
  } catch {
    return false;
  }
}

export async function listProjects(dir: string): Promise<ArchiveProject[]> {
  try {
    const r = await fetch(BASE + "/list?dir=" + encodeURIComponent(dir));
    if (!r.ok) return [];
    const j = await r.json();
    return j.projects || [];
  } catch {
    return [];
  }
}

export async function loadMeta(dir: string, id: string): Promise<ArchiveMeta | null> {
  try {
    const r = await fetch(BASE + "/meta?dir=" + encodeURIComponent(dir) + "&id=" + encodeURIComponent(id));
    if (!r.ok) return null;
    const j = await r.json();
    return j.meta || null;
  } catch {
    return null;
  }
}

export async function saveMeta(dir: string, id: string, meta: Partial<ArchiveMeta>): Promise<boolean> {
  try {
    const r = await fetch(BASE + "/meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dir, id, meta })
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function saveAudio(dir: string, id: string, unitId: number, blob: Blob): Promise<boolean> {
  try {
    const r = await fetch(BASE + "/audio", {
      method: "POST",
      headers: {
        "X-Archive-Dir": encodeURIComponent(dir),
        "X-Project-Id": id,
        "X-Unit-Id": String(unitId)
      },
      body: blob
    });
    return r.ok;
  } catch {
    return false;
  }
}

export function archiveAudioUrl(dir: string, id: string, unitId: number): string {
  return BASE + "/audio?dir=" + encodeURIComponent(dir) + "&id=" + encodeURIComponent(id) + "&unit=" + unitId;
}

export async function savePlayback(dir: string, id: string, currentIdx: number, globalMs: number, rate = 1): Promise<void> {
  try {
    await fetch(BASE + "/playback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dir, id, currentIdx, globalMs, rate })
    });
  } catch {
    /* 存档服务不可用时静默 */
  }
}
