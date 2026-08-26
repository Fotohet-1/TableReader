import type { Project, UnitAudio } from "./types";

export interface Progress {
  done: number;
  total: number;
  current: string;
  failed: number;
}

export interface SynthSummary {
  total: number;
  ok: number;
  failed: number;
}

export interface SynthFn {
  (text: string, voiceId: string, idx?: number): Promise<{ blob: Blob; durationMs: number }>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 流式合成：按剧本顺序逐句合成，每完成一句按序回调 onUnitReady（带全局时间轴）。
 * 合成满 firstBatchSize 句时 firstReady 触发，可提前进入围读；失败句以空音频占位，播放时跳过。
 */
export function synthesizeStream(
  project: Project,
  opts: {
    firstBatchSize: number;
    onUnitReady: (item: UnitAudio) => void;
    onProgress?: (p: Progress) => void;
    synthFn: SynthFn;
  }
): { firstReady: Promise<void>; done: Promise<SynthSummary> } {
  const units = project.units.filter((u) => u.text.trim());
  const total = units.length;
  const voiceMap: Record<string, string> = {};
  for (const v of project.voices) voiceMap[v.name] = v.voiceId;

  const results: (UnitAudio | null)[] = new Array(total).fill(null);
  let readyCursor = 0;
  let acc = 0;
  let doneCount = 0;
  let failed = 0;
  let cursor = 0;
  let firstFired = false;
  let firstResolve!: () => void;
  const firstReady = new Promise<void>((r) => (firstResolve = r));
  let resolveDone!: (s: SynthSummary) => void;
  const done = new Promise<SynthSummary>((r) => (resolveDone = r));

  const CONCURRENCY = 3;
  const firstTarget = Math.min(opts.firstBatchSize, total);

  function flush() {
    while (readyCursor < total && results[readyCursor]) {
      const item = results[readyCursor]!;
      item.startMs = acc;
      acc += item.durationMs;
      item.endMs = acc;
      opts.onUnitReady(item);
      readyCursor++;
      if (!firstFired && readyCursor >= firstTarget) {
        firstFired = true;
        firstResolve();
      }
    }
  }

  async function synthWithRetry(text: string, voiceId: string, idx: number) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await opts.synthFn(text, voiceId, idx);
      } catch {
        if (attempt < 1) await sleep(1000);
      }
    }
    throw new Error("合成失败");
  }

  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= total) break;
      const u = units[idx];
      const voiceId = voiceMap[u.character] || "zh-CN-XiaoxiaoNeural";
      opts.onProgress?.({ done: doneCount, total, current: u.text.slice(0, 18), failed });
      try {
        const r = await synthWithRetry(u.text, voiceId, idx);
        results[idx] = {
          unitId: u.id,
          url: URL.createObjectURL(r.blob),
          durationMs: r.durationMs,
          startMs: 0,
          endMs: 0
        };
      } catch {
        failed++;
        results[idx] = { unitId: u.id, url: "", durationMs: 0, startMs: 0, endMs: 0 };
      }
      doneCount++;
      flush();
      opts.onProgress?.({ done: doneCount, total, current: "", failed });
    }
  }

  Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(total, 1)) }, () => worker())).then(() => {
    flush();
    if (!firstFired) {
      firstFired = true;
      firstResolve();
    }
    resolveDone({ total, ok: total - failed, failed });
  });

  return { firstReady, done };
}
