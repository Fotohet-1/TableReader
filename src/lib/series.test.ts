import { describe, expect, it } from "vitest";
import { seriesKeyFromFile, slugify } from "./series";

describe("seriesKeyFromFile", () => {
  it("从文件名提取稳定剧名", () => {
    expect(seriesKeyFromFile("01《枭起青壤》第一集【定稿剧本】V2.docx")).toBe("枭起青壤");
    expect(seriesKeyFromFile("02《枭起青壤》第二集【定稿剧本】V2.docx")).toBe("枭起青壤");
    expect(seriesKeyFromFile("《沉默之声》七稿第一集0820.docx")).toBe("沉默之声");
    expect(seriesKeyFromFile("《沉默之声》七稿第二集0820.docx")).toBe("沉默之声");
    expect(seriesKeyFromFile("《你到底要去哪》.docx")).toBe("你到底要去哪");
  });
  it("无标题返回 null", () => {
    expect(seriesKeyFromFile("第1集")).toBeNull();
  });
});

describe("slugify", () => {
  it("替换路径非法字符，保留中文", () => {
    expect(slugify("枭起/青壤")).toBe("枭起-青壤");
    expect(slugify("炎拓")).toBe("炎拓");
  });
});
