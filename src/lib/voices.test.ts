import { describe, expect, it } from "vitest";
import { guessGender, defaultEdgeVoiceFor, defaultVoiceDescFor } from "./voices";

describe("guessGender", () => {
  it("按标题/尾字判断性别", () => {
    expect(guessGender("王姐")).toBe("女");
    expect(guessGender("李叔")).toBe("男");
    expect(guessGender("林芳")).toBe("女");
    expect(guessGender("王强")).toBe("男");
    expect(guessGender("陈可")).toBe("未知");
  });
});

describe("defaultEdgeVoiceFor", () => {
  it("旁白固定晓晓", () => {
    expect(defaultEdgeVoiceFor({ name: "旁白" })).toBe("zh-CN-XiaoxiaoNeural");
  });
  it("按性别年龄映射", () => {
    expect(defaultEdgeVoiceFor({ name: "角色", gender: "男", age: "老年" })).toBe("zh-CN-YunjianNeural");
    expect(defaultEdgeVoiceFor({ name: "角色", gender: "男", age: "青年" })).toBe("zh-CN-YunxiNeural");
    expect(defaultEdgeVoiceFor({ name: "角色", gender: "女", age: "少年" })).toBe("zh-CN-XiaoyiNeural");
    expect(defaultEdgeVoiceFor({ name: "角色", gender: "女", age: "中年" })).toBe("zh-CN-XiaoxiaoNeural");
  });
});

describe("defaultVoiceDescFor", () => {
  it("包含性别年龄与语气", () => {
    const d = defaultVoiceDescFor({ name: "炎拓", gender: "男", age: "青年" });
    expect(d).toContain("男声");
    expect(d).toContain("青年");
    expect(d).toContain("自然");
    expect(d).toContain("语速 匀速");
  });
});
