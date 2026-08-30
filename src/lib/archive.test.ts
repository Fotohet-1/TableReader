import { afterEach, describe, expect, it, vi } from "vitest";
import { mergeVoiceBanks, revealDir, type VoiceBankEntry } from "./archive";

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

describe("revealDir", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("服务返回成功时结果为 true", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    await expect(revealDir("~/dir")).resolves.toBe(true);
  });

  it("请求失败时结果为 false", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    await expect(revealDir("~/dir")).resolves.toBe(false);
  });
});
