import type { ArchiveContext, CharacterVoice, Project, Unit } from "./types";
import { slugify } from "./series";

export interface EpisodeSegment {
  episode: number;
  text: string;
  name?: string;
  units?: Unit[];
}

export interface EpisodeArchiveItem {
  project: Project;
  ctx: ArchiveContext;
}

/** 多文件上传：每个文件拆成一个独立存档条目，不再把整批并成一个集 */
export function splitMultiEpisodeArchive(
  segments: EpisodeSegment[],
  voices: CharacterVoice[],
  archiveDir: string,
  seriesId: string,
  seriesName: string
): EpisodeArchiveItem[] {
  return segments.map((seg) => {
    const name = seg.name || "第" + seg.episode + "集";
    const ctx: ArchiveContext = {
      dir: archiveDir,
      series: seriesId,
      seriesName,
      episode: slugify(name),
      episodeName: name
    };
    return {
      project: { scriptText: seg.text, units: seg.units || [], voices, archive: ctx },
      ctx
    };
  });
}
