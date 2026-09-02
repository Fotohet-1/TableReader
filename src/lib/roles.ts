import { normalizeRoleName, roleBase } from "./parser";

export interface RoleGroup {
  canonical: string;
  variants: string[];
  count: number;
}

/**
 * 角色名分组归并：
 * 1) 先做基础清洗（括号 / OS / 尾随群组词）
 * 2) 前缀归并：对每个名字，取所有名字里"最短且为前缀"的那一个作为 canonical，
 *    与出现顺序和次数无关（炎拓 总裁 → 炎拓；聂九罗 董事长 → 聂九罗）。
 * 3) 单字名不作归并基底，避免把完整的双字/多字名误并进单字姓/名。
 * 4) 按出现次数降序输出。
 */
export function groupRoles(cleanedNames: string[]): RoleGroup[] {
  const counts = new Map<string, number>();
  for (const n of cleanedNames) counts.set(n, (counts.get(n) || 0) + 1);
  const names = Array.from(counts.keys());
  // 长度升序，长度相同按次数降序，保证"最短且高频"的基底先被选中
  const byLen = [...names].sort(
    (a, b) => a.length - b.length || (counts.get(b)! - counts.get(a)!)
  );
  const canonicalOf = new Map<string, string>();
  for (const name of names) {
    let canonical = name;
    for (const cand of byLen) {
      if (cand === name) continue;
      // 单字名不作为归并基底，避免误合并
      if (cand.length < 2) continue;
      if (name.startsWith(cand) && cand.length < canonical.length) canonical = cand;
    }
    canonicalOf.set(name, canonical);
  }
  const groupMap = new Map<string, RoleGroup>();
  for (const [name, cnt] of counts) {
    const canon = canonicalOf.get(name)!;
    const g = groupMap.get(canon);
    if (g) {
      if (name !== canon) g.variants.push(name);
      g.count += cnt;
    } else {
      groupMap.set(canon, {
        canonical: canon,
        variants: name === canon ? [canon] : [canon, name],
        count: cnt
      });
    }
  }
  return Array.from(groupMap.values()).sort((a, b) => b.count - a.count);
}

/**
 * 确认角色页排序：无音色种子（新角色）在前，可复用（有种子）在后，各自按台词数降序。
 * 纯函数，便于单元测试。
 */
export function sortRolesForConfirm<T extends { name: string; lines?: number }>(
  profiles: T[],
  bank: Record<string, unknown>
): T[] {
  const hasSeed = (p: T) => !!bank[roleBase(p.name)];
  return [...profiles].sort((a, b) => {
    const sa = hasSeed(a) ? 1 : 0;
    const sb = hasSeed(b) ? 1 : 0;
    if (sa !== sb) return sa - sb;
    return (b.lines || 0) - (a.lines || 0) || a.name.localeCompare(b.name, "zh-Hans-CN");
  });
}

const SEED_CHARS_TARGET = 33;
const SEED_CHARS_MIN = 25;
const SEED_CHARS_MAX = 40;
const FALLBACK_SEED_LINE = "夜色渐深，街角的咖啡店还亮着灯。";

/** 挑一句约 8-10 秒的台词作种子文本基底，避免首句过短或语气太特殊 */
export function pickStableSeedLine(lines: string[]): string {
  const scored = lines
    .filter((l) => l && l.trim())
    .map((l) => {
      const chars = l.replace(/\s+/g, "").length;
      return { line: l.trim(), chars, dist: Math.abs(chars - SEED_CHARS_TARGET) };
    });
  if (!scored.length) return FALLBACK_SEED_LINE;
  const inRange = scored.filter((x) => x.chars >= SEED_CHARS_MIN && x.chars <= SEED_CHARS_MAX);
  const pool = inRange.length ? inRange : scored;
  return pool.sort((a, b) => a.dist - b.dist || a.line.localeCompare(b.line, "zh-Hans-CN"))[0].line;
}

export { normalizeRoleName };
