import { describe, expect, it } from "vitest";
import type { Unit } from "./types";
import { splitMultiEpisodeArchive } from "./episodes";

function unit(id: number, episode?: number): Unit {
  return {
    id,
    type: "dialogue",
    character: "李火旺",
    text: "对白",
    start: 0,
    end: 2,
    episode
  };
}

describe("splitMultiEpisodeArchive", () => {
  it("每个上传文件生成一个独立存档条目", () => {
    const items = splitMultiEpisodeArchive(
      [
        { episode: 4, name: "《火旺》E04-260815", text: "第四集", units: [unit(0, 4)] },
        { episode: 5, name: "《火旺》E05-260816", text: "第五集", units: [unit(0, 5)] }
      ],
      [],
      "/tmp/存档",
      "火旺",
      "火旺"
    );
    expect(items).toHaveLength(2);
    expect(items[0].ctx.episodeName).toBe("《火旺》E04-260815");
    expect(items[1].ctx.episodeName).toBe("《火旺》E05-260816");
    expect(items[0].ctx.episode).not.toBe(items[1].ctx.episode);
    expect(items[0].project.scriptText).toBe("第四集");
    expect(items[1].project.scriptText).toBe("第五集");
    expect(items[0].project.units[0].id).toBe(0);
  });

  it("没有文件名时用集号兜底", () => {
    const items = splitMultiEpisodeArchive(
      [{ episode: 2, text: "正文", units: [] }],
      [],
      "/tmp/存档",
      "剧",
      "剧"
    );
    expect(items[0].ctx.episodeName).toBe("第2集");
  });
});
