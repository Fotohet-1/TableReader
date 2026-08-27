import { describe, expect, it } from "vitest";
import { defaultVoiceTags, tagLabelFor, baseVoiceIdOf } from "./voiceTags";

describe("defaultVoiceTags", () => {
  it("14 个基础音色 × 5 语调 = 70 个音色位", () => {
    expect(Object.keys(defaultVoiceTags())).toHaveLength(70);
  });

  it("普通话原声默认启用，童声/方言只开原声", () => {
    const tags = defaultVoiceTags();
    expect(tags["zh-CN-XiaoxiaoNeural"].enabled).toBe(true);
    expect(tags["zh-CN-XiaoxiaoNeural"].gender).toBe("女");
    // 少年档默认特殊
    expect(tags["zh-CN-XiaoyiNeural#p20"].special).toBe(true);
    // 方言基础只启用原声档
    expect(tags["zh-CN-liaoning-XiaobeiNeural"].enabled).toBe(true);
    expect(tags["zh-CN-liaoning-XiaobeiNeural#p10"].enabled).toBe(false);
  });
});

describe("baseVoiceIdOf / tagLabelFor", () => {
  it("去掉语调后缀取基础音色", () => {
    expect(baseVoiceIdOf("zh-CN-YunxiNeural#p10")).toBe("zh-CN-YunxiNeural");
    expect(baseVoiceIdOf("zh-CN-YunxiNeural")).toBe("zh-CN-YunxiNeural");
  });

  it("拼接音色标签", () => {
    const tags = defaultVoiceTags();
    const label = tagLabelFor("zh-CN-XiaoxiaoNeural", "晓晓", tags);
    expect(label).toContain("晓晓");
    expect(label).toContain("女");
  });
});
