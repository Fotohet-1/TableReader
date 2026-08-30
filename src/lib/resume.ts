import { synthesizeStream, type Progress, type SynthSummary } from "./synth";
import type { ArchiveContext, Project, UnitAudio, VoiceSpec } from "./types";
import { saveAudio, archiveAudioUrl } from "./archive";
import { edgeSynthOne, qwenSynthOne, qwenCloneSynthOne } from "./tts";

export interface ResumeSynthOpts {
  project: Project;
  source: "edge" | "qwen";
  archiveCtx: ArchiveContext;
  edgeUrl: string;
  qwenUrl: string;
  existingAudio: Record<number, { url: string; durationMs: number }>;
  voiceMapRef: { current: Record<string, VoiceSpec> };
  regenClaimedRef: { current: Map<number, { url: string; durationMs: number }> };
  onUnitReady: (item: UnitAudio) => void;
  onProgress?: (p: Progress) => void;
}

/** 继续围读时补齐缺失对白：复用已合成音频，只合成缺的，写回归档。 */
export function continueSynthesis(opts: ResumeSynthOpts): { firstReady: Promise<void>; done: Promise<SynthSummary> } {
  const { project, source, archiveCtx, edgeUrl, qwenUrl, existingAudio, voiceMapRef, regenClaimedRef, onUnitReady, onProgress } = opts;
  return synthesizeStream(project, {
    firstBatchSize: 25,
    concurrency: source === "qwen" ? 2 : 3,
    onUnitReady,
    onProgress,
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
