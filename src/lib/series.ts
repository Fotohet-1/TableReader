/** 把剧名转成安全的文件夹/id：只替换路径非法字符，保留中文与空格 */
export function slugify(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, "-").trim();
}

/**
 * 从文件名提取剧名（系列键）。
 * 依次剥掉：扩展名、集标(第X集/第一集)、前导编号(01)、注解/括号、书名号、版本/稿次/日期。
 * 返回剩余标题；无内容则 null。
 */
export function seriesKeyFromFile(filename: string): string | null {
  let base = filename.replace(/\.[^.]+$/, "");
  base = base.replace(/第\s*[0-9一二三四五六七八九十百零两]+\s*[集话回]/g, "");
  base = base.replace(/[一二三四五六七八九十]+稿/g, "");
  base = base.replace(/v\d+/gi, "");
  base = base.replace(/E\d+(?:-\d+)?/gi, "");
  base = base.replace(/\d{4}/g, "");
  base = base.replace(/^\s*0?\d+[\s._-]*/, "");
  base = base.replace(/【.*?】|\[.*?\]|（.*?）|\(.*?\)|〈.*?〉/g, "");
  base = base.replace(/[《》]/g, "");
  base = base.replace(/(?:定稿|终稿|初稿|修订|改)$/i, "");
  base = base.replace(/[\s._-]+$/g, "").trim();
  return base || null;
}
