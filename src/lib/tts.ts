export interface BaseVoiceInfo {
  category: string;
  source_name: string;
}

export interface TTSResult {
  blob: Blob;
  durationMs: number;
}

export async function checkHealth(baseUrl: string): Promise<boolean> {
  try {
    const resp = await fetch(baseUrl.replace(/\/+$/, "") + "/health", { method: "POST" });
    return resp.ok;
  } catch {
    return false;
  }
}

export async function fetchEdgeVoices(baseUrl: string): Promise<Record<string, BaseVoiceInfo>> {
  try {
    const resp = await fetch(baseUrl + "/voices");
    if (!resp.ok) return {};
    return await resp.json();
  } catch {
    return {};
  }
}

export async function edgeSynthOne(baseUrl: string, text: string, voiceId: string): Promise<TTSResult> {
  const resp = await fetch(baseUrl + "/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice_id: voiceId })
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error("edge-tts 失败 HTTP " + resp.status + " " + t.slice(0, 120));
  }
  const buf = await resp.arrayBuffer();
  const blob = new Blob([buf], { type: "audio/wav" });
  return { blob, durationMs: wavDurationMs(buf) };
}

/** Qwen3-TTS VoiceDesign：按自然语言描述生成语音 */
export async function qwenSynthOne(baseUrl: string, text: string, instruct: string): Promise<TTSResult> {
  const resp = await fetch(baseUrl + "/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, instruct })
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error("Qwen3-TTS 失败 HTTP " + resp.status + " " + t.slice(0, 120));
  }
  const buf = await resp.arrayBuffer();
  const blob = new Blob([buf], { type: "audio/wav" });
  return { blob, durationMs: wavDurationMs(buf) };
}

/** Qwen3-TTS Base：用固定参考音色克隆生成，保证角色音色统一 */
export async function qwenCloneSynthOne(
  baseUrl: string,
  text: string,
  audioB64: string,
  refText: string
): Promise<TTSResult> {
  const resp = await fetch(baseUrl + "/tts-clone", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, audio_b64: audioB64, ref_text: refText })
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error("Qwen3-TTS 克隆失败 HTTP " + resp.status + " " + t.slice(0, 120));
  }
  const buf = await resp.arrayBuffer();
  const blob = new Blob([buf], { type: "audio/wav" });
  return { blob, durationMs: wavDurationMs(buf) };
}

function wavDurationMs(buf: ArrayBuffer): number {
  try {
    const view = new DataView(buf);
    const sampleRate = view.getUint32(24, true);
    const channels = view.getUint16(22, true);
    const bits = view.getUint16(34, true);
    const bytesPerSec = sampleRate * channels * (bits / 8);
    let offset = 12;
    while (offset + 8 <= view.byteLength) {
      const id = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
      const size = view.getUint32(offset + 4, true);
      if (id === "data") return bytesPerSec > 0 ? Math.round((size / bytesPerSec) * 1000) : 0;
      offset += 8 + size + (size % 2);
    }
  } catch {
    /* 非 wav 数据，时长按 0 处理 */
  }
  return 0;
}
