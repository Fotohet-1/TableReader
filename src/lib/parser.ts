import type { Unit } from "./types";

const SCENE_RE = /^(内景|外景|内景\/外景)\s*[^\n]{0,40}$/;
const SCENE_NO_RE = /^(\d+[.、．]?\s*|第\s*\d+\s*场[：:、\s]*)/;
const SCENE_RE2 = /^[^\n：]{1,26}(?:日|夜|晨|昏|清晨|傍晚|夜晚|白天|早上|中午|下午|晚上|黄昏)\s*(?:内|外)$/;
const DIALOGUE_RE = /^([^：\n]{1,14}?)[:：](.*)$/;
const PAREN_LINE_RE = /^[（(][\s\S]*[)）]$/;
const PAREN_RE = /[（(][^（）()]*[)）]/g;
const EPISODE_LINE_RE = /^第\s*([0-9]+|[一二三四五六七八九十百零两]+)\s*(集|话|回)[：:、\s]?/;
const EPISODE_NAME_RE = /第\s*([0-9]+|[一二三四五六七八九十百零两]+)\s*(集|话|回)/;

const CN_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const CN_UNITS = ["", "十", "百", "千"];

export function toChineseNumber(n: number): string {
  if (n <= 0) return "零";
  if (n < 10) return CN_DIGITS[n];
  if (n < 20) return "十" + (n % 10 ? CN_DIGITS[n % 10] : "");
  const digits: number[] = [];
  let x = n;
  while (x > 0) {
    digits.push(x % 10);
    x = Math.floor(x / 10);
  }
  let s = "";
  let needZero = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    const d = digits[i];
    if (d === 0) {
      if (s) needZero = true;
    } else {
      if (needZero) {
        s += "零";
        needZero = false;
      }
      s += CN_DIGITS[d] + CN_UNITS[i];
    }
  }
  return s;
}

export function parseChineseNumber(s: string): number | null {
  const map: Record<string, number> = {
    零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
    十: 10, 百: 100, 千: 1000
  };
  const parts = s.split("").filter((ch) => map[ch] !== undefined);
  if (!parts.length) return null;
  let total = 0;
  let section = 0;
  let num = 0;
  for (const ch of parts) {
    const v = map[ch];
    if (v >= 10) {
      if (v === 10 && num === 0) num = 1;
      section += (num || 1) * v;
      num = 0;
      if (v === 100 || v === 1000) {
        total += section;
        section = 0;
      }
    } else {
      num = v;
    }
  }
  return total + section + num;
}

/** 从文件名提取集数：支持“第1集”“第一集”“01 集”等写法 */
export function episodeFromName(name: string): number | null {
  const m = name.match(EPISODE_NAME_RE);
  if (!m) return null;
  const raw = m[1];
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  return parseChineseNumber(raw);
}

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

export function parseScript(text: string, opts?: { episode?: number; idStart?: number }): Unit[] {
  const clean = text.replace(/\r/g, "");
  const lines = clean.split("\n");
  const units: Unit[] = [];
  let offset = 0;
  let id = opts?.idStart || 0;
  let sceneCounter = 0;
  let episode = opts?.episode || 1;
  let episodeFirstScene = true;
  for (const raw of lines) {
    const lineStart = offset;
    offset += raw.length + 1;
    const trimmed = raw.trim();
    const tStart = lineStart + raw.indexOf(trimmed);
    if (!trimmed) continue;

    const epMatch = trimmed.match(EPISODE_LINE_RE);
    if (epMatch) {
      const epRaw = epMatch[1];
      const epNum = /^\d+$/.test(epRaw) ? parseInt(epRaw, 10) : parseChineseNumber(epRaw);
      if (epNum) episode = epNum;
      sceneCounter = 0;
      episodeFirstScene = true;
      const u = mk(id++, "narration", "旁白", trimmed, tStart);
      u.episode = episode;
      units.push(u);
      continue;
    }

    if (SCENE_RE.test(trimmed) || SCENE_RE2.test(trimmed)) {
      sceneCounter++;
      const noMatch = trimmed.match(SCENE_NO_RE);
      const sceneNo = noMatch ? noMatch[0].trim() : "第" + sceneCounter + "场";
      const sceneNum = noMatch ? parseInt((noMatch[0].match(/\d+/) || ["0"])[0], 10) : sceneCounter;
      const cnEp = toChineseNumber(episode);
      const cnSc = toChineseNumber(sceneNum);
      const prefix = episodeFirstScene ? "第" + cnEp + "集，" : "";
      episodeFirstScene = false;
      const u = mk(id++, "scene", "旁白", trimmed, tStart);
      u.sceneNo = sceneNo;
      u.episode = episode;
      u.text = prefix + "第" + cnSc + "场，" + trimmed;
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
