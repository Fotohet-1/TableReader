import { synthesizeStream, type Progress, type SynthSummary } from "./synth";
import type { ArchiveContext, Project, UnitAudio } from "./types";
import { saveAudio, archiveAudioUrl } from "./archive";
import { edgeSynthOne, qwenSynthOne, qwenCloneSynthOne } from "./tts";

export interface ResumeSynthOpts {
  project: Project;
  source: "edge" | "qwen";
  archiveCtx: ArchiveContext;
  edgeUrl: string;
  qwenUrl: string;
  existingAudio: Record<number, { url: string; durationMs: number }>;
  onUnitReady: (item: UnitAudio) => void;
  onProgress?: (p: Progress) => void;
}

/** 继续围读时补齐缺失对白：复用已合成音频，只合成缺的，写回归档。 */
export function continueSynthesis(opts: ResumeSynthOpts): { firstReady: Promise<void>; done: Promise<SynthSummary> } {
  const { project, source, archiveCtx, edgeUrl, qwenUrl, existingAudio, onUnitReady, onProgress } = opts;
  const descMap: Record<string, string> = {};
  const cloneMap: Record<string, { b64: string; refText: string }> = {};
  for (const cv of project.voices) {
    if (cv.voiceDesc) descMap[cv.name] = cv.voiceDesc;
    if (cv.cloneAudioB64 && cv.cloneRefText) cloneMap[cv.name] = { b64: cv.cloneAudioB64, refText: cv.cloneRefText };
  }
  return synthesizeStream(project, {
    firstBatchSize: 25,
    concurrency: source === "qwen" ? 2 : 3,
    onUnitReady,
    onProgress,
    existing: Object.keys(existingAudio).length ? existingAudio : undefined,
    synthFn: async (t, v, idx, unitId) => {
      const r = source === "qwen"
        ? (cloneMap[v]
            ? await qwenCloneSynthOne(qwenUrl, t, cloneMap[v].b64, cloneMap[v].refText)
            : await qwenSynthOne(qwenUrl, t, descMap[v] || ""))
        : await edgeSynthOne(edgeUrl, t, v);
      if (unitId != null) {
        const ok = await saveAudio(archiveCtx.dir, archiveCtx.series, archiveCtx.episode, unitId, r.blob);
        if (ok) {
          return { ...r, url: archiveAudioUrl(archiveCtx.dir, archiveCtx.series, archiveCtx.episode, unitId) };
        }
      }
      return r;
    }
  });
}
