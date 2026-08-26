export interface VoiceTag {
  gender: string;
  age: string;
  name: string;
  dialect: string;
  special: boolean;
  enabled: boolean;
}

export const PITCHES: Array<{ suffix: string; label: string }> = [
  { suffix: "#m20", label: "低沉" },
  { suffix: "#m10", label: "微沉" },
  { suffix: "", label: "原声" },
  { suffix: "#p10", label: "微亮" },
  { suffix: "#p20", label: "清亮" }
];

const LS_TAGS = "sr_edge_voice_tags_v1";

/** 语调档位对应的默认年龄段，供预填后校对 */
function ageForPitch(suffix: string, baseAge: string): string {
  if (suffix === "#m20") return "老年";
  if (suffix === "#m10") return "中年";
  if (suffix === "#p10") return "青年";
  if (suffix === "#p20") return "少年";
  return baseAge;
}

/** 预填的微软音色信息：14 个基础音色 × 5 档语调，每档都是独立音色标签 */
export function defaultVoiceTags(): Record<string, VoiceTag> {
  const t = (gender: string, age: string, name: string, dialect = "") => ({
    gender,
    age,
    name,
    dialect,
    special: false,
    enabled: true
  });
  const bases: Record<string, VoiceTag> = {
    "zh-CN-XiaoxiaoNeural": t("女", "青年", "晓晓"),
    "zh-CN-XiaoyiNeural": t("女", "青年", "晓伊"),
    "zh-CN-YunjianNeural": t("男", "中年", "云健"),
    "zh-CN-YunxiNeural": t("男", "青年", "云希"),
    "zh-CN-YunxiaNeural": t("男", "少年", "云夏"),
    "zh-CN-YunyangNeural": t("男", "青年", "云扬"),
    "zh-CN-liaoning-XiaobeiNeural": t("女", "青年", "小北", "东北话"),
    "zh-CN-shaanxi-XiaoniNeural": t("女", "青年", "小妮", "陕西话"),
    "zh-HK-HiuGaaiNeural": t("女", "青年", "曉佳", "粤语"),
    "zh-HK-HiuMaanNeural": t("女", "青年", "曉曼", "粤语"),
    "zh-HK-WanLungNeural": t("男", "中年", "雲龍", "粤语"),
    "zh-TW-HsiaoChenNeural": t("女", "青年", "曉臻", "台湾口音"),
    "zh-TW-HsiaoYuNeural": t("女", "青年", "曉雨", "台湾口音"),
    "zh-TW-YunJheNeural": t("男", "青年", "雲哲", "台湾口音")
  };
  const out: Record<string, VoiceTag> = {};
  for (const [id, tag] of Object.entries(bases)) {
    for (const p of PITCHES) {
      const age = ageForPitch(p.suffix, tag.age);
      const special = tag.dialect !== "" || age === "少年";
      // 特殊音色（方言/童声）默认只启用原声档，避免整组涌进可用池
      out[id + p.suffix] = { ...tag, age, special, enabled: special ? p.suffix === "" : true };
    }
  }
  return out;
}

export function loadVoiceTags(): Record<string, VoiceTag> {
  const defaults = defaultVoiceTags();
  try {
    const raw = localStorage.getItem(LS_TAGS);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Record<string, Partial<VoiceTag>>;
    const merged: Record<string, VoiceTag> = { ...defaults };
    for (const [k, tag] of Object.entries(parsed)) {
      if (!tag || typeof tag !== "object") continue;
      if (k.includes("#")) {
        merged[k] = { ...merged[k], ...tag };
      } else {
        // 旧格式：基础音色标签，复制到它的全部语调档
        for (const p of PITCHES) {
          const vk = k + p.suffix;
          merged[vk] = { ...merged[vk], ...tag };
        }
      }
    }
    return merged;
  } catch {
    return defaults;
  }
}

export function saveVoiceTags(tags: Record<string, VoiceTag>): void {
  localStorage.setItem(LS_TAGS, JSON.stringify(tags));
}

export function baseVoiceIdOf(key: string): string {
  return key.split("#")[0];
}

export function tagLabelFor(
  voiceId: string,
  sourceName: string,
  tags: Record<string, VoiceTag>
): string {
  const tag = tags[voiceId] || tags[baseVoiceIdOf(voiceId)];
  const parts = [sourceName];
  if (tag) {
    if (tag.gender) parts.push(tag.gender);
    if (tag.age) parts.push(tag.age);
    if (tag.dialect) parts.push(tag.dialect);
  }
  return parts.join(" · ");
}
