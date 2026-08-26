import JSZip from "jszip";

/** 从 docx 提取“加粗且前有空行”的段落文本，作为疑似场标的结构信号 */
export async function extractSceneCandidates(buf: ArrayBuffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buf);
  const file = zip.file("word/document.xml");
  if (!file) return [];
  const xml = await file.async("string");
  const paras = xml.split(/<w:p\b/);
  const rows: Array<{ text: string; bold: boolean }> = [];
  for (let i = 1; i < paras.length; i++) {
    const p = paras[i];
    const texts = [...p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) =>
      m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    );
    rows.push({ text: texts.join("").trim(), bold: /<w:b\/>/.test(p) });
  }
  const out: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.text || !r.bold) continue;
    const prevEmpty = i === 0 || rows[i - 1].text === "";
    if (!prevEmpty) continue;
    if (/(第\s*[0-9一二三四五六七八九十]+\s*集|完|待续|出片名)/.test(r.text)) continue;
    out.push(r.text);
  }
  return Array.from(new Set(out));
}
