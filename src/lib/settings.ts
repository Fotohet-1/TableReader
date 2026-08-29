export type TtsSource = "edge" | "qwen";

export const APP_VERSION = "v1.1.0";

const KEYS = {
  source: "sr_tts_source",
  dsKey: "sr_ds_key",
  aiRoles: "sr_ai_roles",
  onboarded: "sr_has_onboarded",
  edgeUrl: "sr_edge_url",
  qwenUrl: "sr_qwen_url",
  archiveDir: "sr_archive_dir"
};

export function loadSource(): TtsSource {
  return localStorage.getItem(KEYS.source) === "qwen" ? "qwen" : "edge";
}

export function saveSource(s: TtsSource): void {
  localStorage.setItem(KEYS.source, s);
}

export function loadDsKey(): string {
  return localStorage.getItem(KEYS.dsKey) || "";
}

export function saveDsKey(v: string): void {
  localStorage.setItem(KEYS.dsKey, v);
}

export function loadAiEnabled(): boolean {
  return localStorage.getItem(KEYS.aiRoles) !== "0";
}

export function saveAiEnabled(v: boolean): void {
  localStorage.setItem(KEYS.aiRoles, v ? "1" : "0");
}

export function hasOnboarded(): boolean {
  return localStorage.getItem(KEYS.onboarded) === "1";
}

export function markOnboarded(): void {
  localStorage.setItem(KEYS.onboarded, "1");
}

export function clearOnboarded(): void {
  localStorage.removeItem(KEYS.onboarded);
}

export function loadEdgeUrl(): string {
  return localStorage.getItem(KEYS.edgeUrl) || "http://127.0.0.1:9882";
}

export function saveEdgeUrl(v: string): void {
  localStorage.setItem(KEYS.edgeUrl, v);
}

export function loadQwenUrl(): string {
  return localStorage.getItem(KEYS.qwenUrl) || "http://127.0.0.1:9883";
}

export function saveQwenUrl(v: string): void {
  localStorage.setItem(KEYS.qwenUrl, v);
}

export function loadArchiveDir(): string {
  return localStorage.getItem(KEYS.archiveDir) || "~/Documents/剧本围读存档";
}

export function saveArchiveDir(v: string): void {
  localStorage.setItem(KEYS.archiveDir, v);
}
