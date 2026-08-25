import { normalizeRoleName } from "./parser";

export interface RoleGroup {
  canonical: string;
  variants: string[];
  count: number;
}

/**
 * 角色名分组归并：
 * 1) 先做基础清洗（括号 / OS / 尾随群组词）
 * 2) 前缀归并：变体以基础名为前缀时并入（熊黑严肃 → 熊黑；炎拓/熊黑 → 炎拓）
 * 3) 按出现次数降序，保证高频的基础名先成为组
 */
export function groupRoles(cleanedNames: string[]): RoleGroup[] {
  const counts = new Map<string, number>();
  for (const n of cleanedNames) counts.set(n, (counts.get(n) || 0) + 1);
  const unique = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const groups: RoleGroup[] = [];
  for (const [name, cnt] of unique) {
    const parent = groups.find((g) => name !== g.canonical && name.startsWith(g.canonical));
    if (parent) {
      parent.variants.push(name);
      parent.count += cnt;
    } else {
      groups.push({ canonical: name, variants: [name], count: cnt });
    }
  }
  return groups;
}

export { normalizeRoleName };
