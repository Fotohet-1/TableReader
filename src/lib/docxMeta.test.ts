import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { extractSceneCandidates } from "./docxMeta";

function makeDocx(paras: Array<{ text: string; bold?: boolean }>): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const xml =
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" +
    "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">" +
    paras.map((p) => {
      const run = p.bold
        ? "<w:r><w:rPr><w:b/></w:rPr><w:t>" + p.text + "</w:t></w:r>"
        : "<w:r><w:t>" + p.text + "</w:t></w:r>";
      return "<w:p>" + run + "</w:p>";
    }).join("") +
    "</w:document>";
  zip.file("word/document.xml", xml);
  return zip.generateAsync({ type: "arraybuffer" });
}

describe("extractSceneCandidates", () => {
  it("紧跟集号的标题行不作为场标候选", async () => {
    const buf = await makeDocx([
      { text: "火旺", bold: true },
      { text: "" },
      { text: "第一集", bold: true },
      { text: "清风山-药引库", bold: true }
    ]);
    expect(await extractSceneCandidates(buf)).not.toContain("火旺");
  });

  it("保留未跟集号的加粗短行", async () => {
    const buf = await makeDocx([
      { text: "清风山-药引库", bold: true },
      { text: "日", bold: true },
      { text: "内", bold: true }
    ]);
    expect(await extractSceneCandidates(buf)).toContain("清风山-药引库");
  });
});
