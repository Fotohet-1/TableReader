import type { Unit } from "./types";

const SCENE_RE = /^(内景|外景|内景\/外景)\s*[^\n]{0,40}$/;
const SCENE_NO_RE = /^(\d+[.、．]?\s*|第\s*\d+\s*场[：:、\s]*)/;
const SCENE_RE2 = /^[^\n：]{1,26}(?:日|夜|晨|昏|清晨|傍晚|夜晚|白天|早上|中午|下午|晚上|黄昏)\s*(?:内|外)$/;
const DIALOGUE_RE = /^([^：\n]{1,14}?)[:：](.*)$/;
const PAREN_LINE_RE = /^[（(][\s\S]*[)）]$/;
const PAREN_RE = /[（(][^（）()]*[)）]/g;

/** 角色名基础清洗：剥括号、剥 OS/画外音、剥尾随群组词 */
export function normalizeRoleName(raw: string): string {
  let n = raw.trim();
  n = n.replace(PAREN_RE, "");
  n = n.replace(/(?:os|v\.?o\.?|vo|画外音|内心独白)$/i, "");
  n = n.replace(/(?:齐声|齐|们|一起)$/, "");
  return n.trim();
}

function mk(id: number, type: Unit["type"], character: string, text: string, start: number): Unit {
  return { id, type, character, text, start, end: start + text.length };
}

export function parseScript(text: string): Unit[] {
  const clean = text.replace(/\r/g, "");
  const lines = clean.split("\n");
  const units: Unit[] = [];
  let offset = 0;
  let id = 0;
  let sceneCounter = 0;
  for (const raw of lines) {
    const lineStart = offset;
    offset += raw.length + 1;
    const trimmed = raw.trim();
    const tStart = lineStart + raw.indexOf(trimmed);
    if (!trimmed) continue;

    if (SCENE_RE.test(trimmed) || SCENE_RE2.test(trimmed)) {
      sceneCounter++;
      const noMatch = trimmed.match(SCENE_NO_RE);
      const sceneNo = noMatch ? noMatch[0].trim() : "第" + sceneCounter + "场";
      const u = mk(id++, "scene", "旁白", trimmed, tStart);
      u.sceneNo = sceneNo;
      u.text = sceneNo + " " + trimmed;
      units.push(u);
      continue;
    }

    const dm = trimmed.match(DIALOGUE_RE);
    if (dm) {
      const name = normalizeRoleName(dm[1].trim());
      const speech = dm[2].trim().replace(PAREN_RE, "").trim();
      if (speech) {
        const type: Unit["type"] = name === "旁白" ? "narration" : "dialogue";
        units.push({ id: id++, type, character: name, text: speech, start: tStart, end: tStart + trimmed.length });
      }
      continue;
    }

    if (PAREN_LINE_RE.test(trimmed)) {
      units.push(mk(id++, "action", "旁白", trimmed, tStart));
      continue;
    }

    units.push(mk(id++, "narration", "旁白", trimmed, tStart));
  }
  return units;
}

export function collectCharacters(units: Unit[]): string[] {
  const set = new Set<string>();
  for (const u of units) {
    if (u.type === "dialogue" || u.type === "narration") set.add(u.character);
  }
  return Array.from(set);
}
