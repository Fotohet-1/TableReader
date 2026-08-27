import type { Unit } from "./types";

const SCENE_RE = /^(内景|外景|内景\/外景)\s*[^\n]{0,40}$/;
const SCENE_NO_RE = /^(\d+[A-Za-z]?[.、．]?\s*|第\s*\d+\s*场[：:、\s]*)/;
const SCENE_RE2 = /^[^\n：△]{1,40}(?:日|夜|晨|昏|清晨|傍晚|夜晚|白天|早上|中午|下午|晚上|黄昏)\s*(?:内|外|内\/外|外\/内)(?:\s*[（(][^）)]*[)）])?$/;
const SCENE_EMPTY_RE = /^[^\n：△]{0,24}空镜$/;
const DIALOGUE_RE = /^([^：\n]{1,14}?)[:：](.*)$/;
const PAREN_LINE_RE = /^[（(][\s\S]*[)）]$/;
const PAREN_RE = /[（(][^（）()]*[)）]/g;
const EPISODE_LINE_RE = /^第\s*([0-9]+|[一二三四五六七八九十百零两]+)\s*(集|话|回)[：:、\s]?/;
const EPISODE_NAME_RE = /第\s*([0-9]+|[一二三四五六七八九十百零两]+)\s*(集|话|回)/;
const INSERT_RE = /^INSERT[：:、\s\-—]*/i;

/** 动作行朗读文本：去掉符号，行中 △ 转成句号，避免 TTS 读出符号 */
function cleanActionText(raw: string): string {
  let t = raw.trim();
  t = t.replace(/^[△▲]+/, "");
  t = t.replace(/[△▲]+/g, "。");
  t = t.replace(/。{2,}/g, "。");
  return t.trim();
}

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
  n = n.replace(/(?:笑着|哭着|喊着|冷冷|淡淡|轻轻|微微|低声|大声|高声|低沉|温柔|严肃|认真|急切|慌张|平静|犹豫|笃定|不耐烦|好奇|惊讶|震惊|激动|愤怒|生气|高兴|难过|无奈|僵住|愣住|呆住|怔住|顿住|站住)$/, "");
  n = n.replace(/(?:异口同声|同时说道|同时开口|说道|喊道|问道|答道|回答道|开口|开口说|开口问|接着说|继续说|打断|插话|叹道|笑道|苦笑|冷笑|低语|嘀咕|嘟囔|吆喝|哀叹|惊叫|哽咽)$/, "");
  // 状态+时长尾缀：熊黑迟疑片刻 → 熊黑
  n = n.replace(/(?:迟疑|沉吟|沉默|愣|怔|顿|踌躇|犹豫|想了想)(?:了片刻|了一下|片刻)?$/, "");
  // 称谓/指向："院长对红丝巾阿姨" → "院长"；A对B说 → A（B 是被指向的人，不是说话人）
  n = n.replace(/^(.*?)对[^，。、：\n]{1,12}$/g, (_m, left) => left || _m);
  return n.trim();
}

/** 常见头衔/称谓，用于跨集统一身份 */
const TITLE_RE = /(?:\s+(?:董事长|总裁|总经理|老板|经理|医生|大夫|老师|律师|警官|警察|院长|校长|主任|主管|护士|服务员|保安|司机|先生|女士|小姐|夫人|太太|阿姨|爷爷|奶奶|哥哥|姐姐|弟弟|妹妹|大哥|小哥|大叔|大爷|大伯|大婶|大姐|主持人|总监|编辑|记者|作家|画家|歌手|演员|导演|教授|博士|专家|局长|处长|部长|厂长|村长|族长|会长|书记))$/;

/**
 * 跨集稳定身份键：剥离 头衔后缀 / OS / 括注 / 情绪后缀。
 * 与某集内部的 groupRoles 不同，它不依赖当前集的写法集合，
 * 保证 "聂九罗 董事长" 在任何一集都归到 "聂九罗"。
 */
export function roleBase(raw: string): string {
  const n = normalizeRoleName(raw);
  return n.replace(TITLE_RE, "").trim();
}

const CAPTION_SEQ_RE = /^第[一二三四五六七八九十\d]+(?:张|幅|条|个|页)$/;
const CAPTION_NOUN_RE = /(?:内容|文字|字幕|画面|照片)$/;
const DESC_VERB_RE = /(?:显示|出现|传来|写着|赫然|定格|回放)$/;

/** 判断冒号前的部分是否是"人"（说话角色），排除字幕/画面/内容等描写行 */
export function isPersona(raw: string): boolean {
  const n = raw.trim();
  if (!n) return false;
  if (CAPTION_SEQ_RE.test(n)) return false;
  if (/^[A-Za-z][A-Za-z0-9]*$/.test(n)) return true; // 字母代号：D / B / A
  if (CAPTION_NOUN_RE.test(n)) return false;
  if (n.length > 6 && DESC_VERB_RE.test(n)) return false;
  return true;
}

function mk(id: number, type: Unit["type"], character: string, text: string, start: number): Unit {
  return { id, type, character, text, start, end: start + text.length };
}

export function parseScript(
  text: string,
  opts?: { episode?: number; idStart?: number; forcedSceneLines?: Set<string> }
): Unit[] {
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
      u.raw = trimmed;
      units.push(u);
      continue;
    }

    // INSERT 闪回/插叙是场内镜头，不单独算场，按旁白处理
    if (INSERT_RE.test(trimmed)) {
      const u = mk(id++, "narration", "旁白", trimmed, tStart);
      u.raw = trimmed;
      units.push(u);
      continue;
    }

    if (SCENE_RE.test(trimmed) || SCENE_RE2.test(trimmed) || SCENE_EMPTY_RE.test(trimmed)) {
      sceneCounter++;
      const sceneNo = "第" + sceneCounter + "场";
      const cnEp = toChineseNumber(episode);
      const cnSc = toChineseNumber(sceneCounter);
      const prefix = episodeFirstScene ? "第" + cnEp + "集，" : "";
      episodeFirstScene = false;
      const u = mk(id++, "scene", "旁白", trimmed, tStart);
      u.sceneNo = sceneNo;
      u.episode = episode;
      u.raw = trimmed;
      u.text = prefix + "第" + cnSc + "场，" + trimmed;
      units.push(u);
      continue;
    }

    if (opts?.forcedSceneLines?.has(trimmed)) {
      sceneCounter++;
      const sceneNo = "第" + sceneCounter + "场";
      const cnEp = toChineseNumber(episode);
      const cnSc = toChineseNumber(sceneCounter);
      const prefix = episodeFirstScene ? "第" + cnEp + "集，" : "";
      episodeFirstScene = false;
      const u = mk(id++, "scene", "旁白", trimmed, tStart);
      u.sceneNo = sceneNo;
      u.episode = episode;
      u.raw = trimmed;
      u.text = prefix + "第" + cnSc + "场，" + trimmed;
      units.push(u);
      continue;
    }

    // △ 开头是动作/环境描写，即使行内有冒号也不作为台词
    if (trimmed.startsWith("△")) {
      const u = mk(id++, "action", "旁白", cleanActionText(trimmed), tStart);
      u.raw = trimmed;
      units.push(u);
      continue;
    }

    const dm = trimmed.match(DIALOGUE_RE);
    if (dm) {
      const rawName = dm[1].trim();
      const speech = dm[2].trim().replace(PAREN_RE, "").trim();
      if (speech) {
        const name = normalizeRoleName(rawName);
        // 非人角色（字幕/画面/内容等描述行）按旁白处理
        if (name !== "旁白" && !isPersona(rawName)) {
          const u = mk(id++, "narration", "旁白", trimmed, tStart);
          u.raw = trimmed;
          units.push(u);
          continue;
        }
        const type: Unit["type"] = name === "旁白" ? "narration" : "dialogue";
        units.push({ id: id++, type, character: name, text: speech, raw: trimmed, start: tStart, end: tStart + trimmed.length });
      }
      continue;
    }

    if (PAREN_LINE_RE.test(trimmed)) {
      const u = mk(id++, "action", "旁白", trimmed, tStart);
      u.raw = trimmed;
      units.push(u);
      continue;
    }

    const u = mk(id++, "narration", "旁白", trimmed, tStart);
    u.raw = trimmed;
    units.push(u);
  }

  // 联动说话人：A/B、A、B、A和B、AB异口同声 等，拆成同组多人，并重排 id
  const namePool = new Set<string>();
  for (const u of units) {
    if (u.type !== "dialogue") continue;
    const n = u.character;
    if (!n) continue;
    if (/[\/／、，,＋+&和]/.test(n)) {
      for (const s of n.split(/[\/／、，,＋+&]+|\s*和\s*/)) {
        const p = normalizeRoleName(s);
        if (p && p.length >= 2 && p.length <= 4) namePool.add(p);
      }
    } else if (n.length >= 2 && n.length <= 4) {
      namePool.add(n);
    }
  }
  const singleNames = Array.from(namePool);
  const resolved: Unit[] = [];
  for (const u of units) {
    if (u.type === "dialogue") {
      const parts = splitCombinedSpeakers(u.character, singleNames);
      if (parts && parts.length >= 2) {
        const g = 1000000000 + u.id;
        for (const p of parts) {
          resolved.push({ ...u, id: u.id, character: p, group: g, simul: true });
        }
        continue;
      }
    }
    resolved.push(u);
  }
  resolved.forEach((u, i) => { u.id = i; });
  return resolved;
}

function splitCombinedSpeakers(name: string, singleNames: string[]): string[] | null {
  const t = name.trim();
  if (!t) return null;
  if (/[\/／、，,＋+&]/.test(t) || t.includes("和")) {
    const parts = t
      .split(/[\/／、，,＋+&]+|\s*和\s*/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => normalizeRoleName(s))
      .filter((s) => s.length > 0);
    if (parts.length >= 2) return Array.from(new Set(parts));
  }
  for (const a of singleNames) {
    for (const b of singleNames) {
      if (a === b) continue;
      if (t === a + b) {
        return [a, b];
      }
    }
  }
  return null;
}

/** 找出疑似场标但可能未被规则识别的短行（含时间+内外，或空镜） */
export function findLikelySceneLines(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("△") || trimmed.includes("：")) continue;
    if (INSERT_RE.test(trimmed)) continue;
    if (SCENE_EMPTY_RE.test(trimmed)) {
      out.push(trimmed);
      continue;
    }
    if (/^[^\n：△]{1,40}(?:日|夜|晨|昏|清晨|傍晚|夜晚|白天|早上|中午|下午|晚上|黄昏)\s*(?:内|外|内\/外|外\/内)(?:\s*[（(][^）)]*[)）])?$/.test(trimmed)) {
      out.push(trimmed);
      continue;
    }
    // 规则外的疑似写法：独立时间行、内外在前、含空镜的短行
    if (/^(?:日|夜|晨|昏|清晨|傍晚|夜晚|白天|早上|中午|下午|晚上|黄昏)\s*(?:内|外|内\/外|外\/内)$/.test(trimmed)) {
      out.push(trimmed);
      continue;
    }
    if (/^(?:内|外|内\/外|外\/内)\s*(?:日|夜|晨|昏|清晨|傍晚|夜晚|白天|早上|中午|下午|晚上|黄昏)/.test(trimmed)) {
      out.push(trimmed);
      continue;
    }
    if (trimmed.includes("空镜") && trimmed.length <= 30) {
      out.push(trimmed);
    }
  }
  return out;
}

export function collectCharacters(units: Unit[]): string[] {
  const set = new Set<string>();
  for (const u of units) {
    if (u.type === "dialogue" || u.type === "narration") set.add(u.character);
  }
  return Array.from(set);
}
