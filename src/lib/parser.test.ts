import { describe, expect, it } from "vitest";
import {
  parseScript,
  collectCharacters,
  toChineseNumber,
  parseChineseNumber,
  episodeFromName,
  normalizeRoleName,
  findLikelySceneLines,
  roleBase,
  isPersona
} from "./parser";

describe("toChineseNumber", () => {
  it("数字转中文", () => {
    expect(toChineseNumber(0)).toBe("零");
    expect(toChineseNumber(1)).toBe("一");
    expect(toChineseNumber(10)).toBe("十");
    expect(toChineseNumber(11)).toBe("十一");
    expect(toChineseNumber(20)).toBe("二十");
    expect(toChineseNumber(21)).toBe("二十一");
    expect(toChineseNumber(105)).toBe("一百零五");
    expect(toChineseNumber(120)).toBe("一百二十");
  });
});

describe("parseChineseNumber", () => {
  it("中文转数字", () => {
    expect(parseChineseNumber("一")).toBe(1);
    expect(parseChineseNumber("十")).toBe(10);
    expect(parseChineseNumber("十一")).toBe(11);
    expect(parseChineseNumber("二十")).toBe(20);
    expect(parseChineseNumber("二十一")).toBe(21);
    expect(parseChineseNumber("一百零五")).toBe(105);
  });
});

describe("episodeFromName", () => {
  it("从文件名提取集数", () => {
    expect(episodeFromName("第1集.txt")).toBe(1);
    expect(episodeFromName("第一集.txt")).toBe(1);
    expect(episodeFromName("第十二集.txt")).toBe(12);
    expect(episodeFromName("第12话.txt")).toBe(12);
    expect(episodeFromName("无集数.txt")).toBeNull();
  });
});

describe("normalizeRoleName", () => {
  it("剥离动作/情绪/括号后缀", () => {
    expect(normalizeRoleName("熊黑严肃")).toBe("熊黑");
    expect(normalizeRoleName("炎拓（严肃）")).toBe("炎拓");
    expect(normalizeRoleName("林晚(OS)")).toBe("林晚");
    expect(normalizeRoleName("旁白")).toBe("旁白");
  });
  it("剥离'对X'称谓，取指向人为说话人", () => {
    expect(normalizeRoleName("院长对红丝巾阿姨")).toBe("院长");
    expect(normalizeRoleName("炎拓对熊黑说")).toBe("炎拓");
  });
  it("剥离状态+时长尾缀", () => {
    expect(normalizeRoleName("熊黑迟疑片刻")).toBe("熊黑");
    expect(roleBase("熊黑沉吟片刻")).toBe("熊黑");
  });
});

describe("parseScript", () => {
  it("解析场标/对白/动作/旁白", () => {
    const text = [
      "1. 咖啡店 日 内",
      "△林晚 推门进来，风铃响了一声。",
      "林晚：一杯美式，谢谢。",
      "老板：今天还是老样子？",
      "（老板转身去冲咖啡）",
      "旁白：她不知道，这个决定会改变一切。"
    ].join("\n");
    const units = parseScript(text);
    expect(units[0].type).toBe("scene");
    expect(units[0].sceneNo).toBe("第1场");
    expect(units[0].episode).toBe(1);
    expect(units[1].type).toBe("action");
    expect(units[2].type).toBe("dialogue");
    expect(units[2].character).toBe("林晚");
    expect(units[3].character).toBe("老板");
    expect(units[4].type).toBe("action");
    expect(units[5].type).toBe("narration");
    expect(units[5].character).toBe("旁白");
    // id 顺序连续
    expect(units.map((u) => u.id)).toEqual(units.map((_, i) => i));
  });

  it("联动说话拆成同组多人", () => {
    const units = parseScript("1. 咖啡店 日 内\n炎拓/熊黑：住手！");
    const dlg = units.filter((u) => u.type === "dialogue");
    expect(dlg).toHaveLength(2);
    expect(dlg[0].character).toBe("炎拓");
    expect(dlg[1].character).toBe("熊黑");
    expect(dlg[0].simul).toBe(true);
    expect(dlg[0].group).toBe(dlg[1].group);
    expect(dlg[0].text).toBe(dlg[1].text);
  });

  it("INSERT 行按旁白处理，不单算场", () => {
    const units = parseScript("1. 咖啡店 日 内\nINSERT 闪回，林晚小时候\n旁白：回忆结束。");
    const scene = units.filter((u) => u.type === "scene");
    expect(scene).toHaveLength(1);
    expect(units[1].type).toBe("narration");
    expect(units[1].character).toBe("旁白");
  });

  it("集号行重置场序", () => {
    const text = "第1集\n1. 咖啡店 日 内\n旁白：开始。\n第2集\n2. 办公室 夜 内\n旁白：续。";
    const units = parseScript(text);
    const scenes = units.filter((u) => u.type === "scene");
    expect(scenes).toHaveLength(2);
    expect(scenes[0].episode).toBe(1);
    expect(scenes[0].sceneNo).toBe("第1场");
    expect(scenes[1].episode).toBe(2);
    expect(scenes[1].sceneNo).toBe("第1场");
  });
});

describe("collectCharacters", () => {
  it("收集对白与旁白角色", () => {
    const units = parseScript("1. 咖啡店 日 内\n炎拓：走。\n熊黑：好。\n旁白：结束。");
    expect(collectCharacters(units).sort()).toEqual(["旁白", "炎拓", "熊黑"]);
  });
});

describe("findLikelySceneLines", () => {
  it("找出疑似场标短行", () => {
    const lines = findLikelySceneLines("走廊 夜 内\n炎拓：走。\n空镜");
    expect(lines).toContain("走廊 夜 内");
    expect(lines).toContain("空镜");
  });
});

describe("roleBase", () => {
  it("剥离头衔后缀得到稳定身份键", () => {
    expect(roleBase("聂九罗 董事长")).toBe("聂九罗");
    expect(roleBase("炎拓 总裁")).toBe("炎拓");
    expect(roleBase("孙周OS")).toBe("孙周");
    expect(roleBase("薇羽girls（唱）")).toBe("薇羽girls");
  });
});

describe("isPersona", () => {
  it("过滤字幕/内容等非人描述行", () => {
    expect(isPersona("阅后即焚里赫然显示")).toBe(false);
    expect(isPersona("文字内容")).toBe(false);
    expect(isPersona("第一张")).toBe(false);
    expect(isPersona("第二张")).toBe(false);
  });
  it("保留真实角色与有独立声线的标签", () => {
    expect(isPersona("炎拓")).toBe(true);
    expect(isPersona("所有小朋友")).toBe(true);
    expect(isPersona("电子合成音")).toBe(true);
    expect(isPersona("D")).toBe(true);
  });
});
