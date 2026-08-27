import { describe, expect, it } from "vitest";
import { mergeVoiceBanks, type VoiceBankEntry } from "./archive";

describe("mergeVoiceBanks", () => {
  it("保留前几集角色，本集同名角色覆盖，本集新角色加入，不整库替换", () => {
    const yan: VoiceBankEntry = { canonical: "炎拓", variants: ["炎拓"], source: "qwen", age: "中年" };
    const nie: VoiceBankEntry = { canonical: "聂九罗", variants: ["聂九罗"], source: "qwen" };
    const yanUpdated: VoiceBankEntry = { ...yan, age: "青年" };
    const base = { 炎拓: yan, 聂九罗: nie };
    const incoming: Record<string, VoiceBankEntry> = {
      炎拓: yanUpdated,
      大头: { canonical: "大头", variants: ["大头"], source: "qwen" }
    };

    const merged = mergeVoiceBanks(base, incoming);

    expect(Object.keys(merged).sort()).toEqual(["大头", "炎拓", "聂九罗"]);
    expect(merged.炎拓).toEqual(yanUpdated); // 本集确认覆盖
    expect(merged.聂九罗).toEqual(nie); // 前几集角色保留
  });
});
