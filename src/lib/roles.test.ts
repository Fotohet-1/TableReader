import { describe, expect, it } from "vitest";
import { groupRoles } from "./roles";
import { sortRolesForConfirm } from "./roles";
import { roleBase } from "./parser";

describe("groupRoles", () => {
  it("长变体先出现时仍归并到短基底", () => {
    const g = groupRoles(["炎拓 总裁", "熊黑", "炎拓"]);
    const yan = g.find((x) => x.canonical === "炎拓");
    expect(yan).toBeDefined();
    expect(yan!.count).toBe(2);
    expect(yan!.variants).toEqual(["炎拓", "炎拓 总裁"]);
    expect(g.find((x) => x.canonical === "熊黑")).toBeDefined();
  });

  it("空格头衔写法可归并(聂九罗 董事长)", () => {
    const g = groupRoles(["聂九罗 董事长", "聂九罗"]);
    expect(g).toHaveLength(1);
    expect(g[0].canonical).toBe("聂九罗");
    expect(g[0].variants).toEqual(["聂九罗", "聂九罗 董事长"]);
    expect(g[0].count).toBe(2);
  });

  it("无空格后缀也归并", () => {
    const g = groupRoles(["炎拓总裁", "炎拓"]);
    expect(g).toHaveLength(1);
    expect(g[0].canonical).toBe("炎拓");
    expect(g[0].count).toBe(2);
  });

  it("单字名不作为归并基底，避免误合并", () => {
    const g = groupRoles(["王", "王五"]);
    expect(g).toHaveLength(2);
  });

  it("按出现次数降序", () => {
    const g = groupRoles(["炎拓", "熊黑", "炎拓", "林晚"]);
    expect(g.map((x) => x.canonical)).toEqual(["炎拓", "熊黑", "林晚"]);
  });
});

describe("sortRolesForConfirm", () => {
  it("无种子的新角色在前，可复用在后，各自按台词数降序", () => {
    const roles = [
      { name: "聂九罗", lines: 19 },
      { name: "大头", lines: 12 },
      { name: "炎拓", lines: 20 },
      { name: "林喜柔", lines: 8 },
      { name: "蒋百川", lines: 16 }
    ];
    const bank = { [roleBase("炎拓")]: {}, [roleBase("聂九罗")]: {} };
    const sorted = sortRolesForConfirm(roles, bank);
    expect(sorted.map((r) => r.name)).toEqual(["蒋百川", "大头", "林喜柔", "炎拓", "聂九罗"]);
  });

  it("有种子但台词少的可复用角色仍排在无种子角色之后", () => {
    const roles = [
      { name: "炎拓", lines: 1 },
      { name: "大头", lines: 60 }
    ];
    const bank = { [roleBase("炎拓")]: {} };
    const sorted = sortRolesForConfirm(roles, bank);
    expect(sorted.map((r) => r.name)).toEqual(["大头", "炎拓"]);
  });
});
