export interface VoiceTag {
  gender: string;
  age: string;
  name: string;
  dialect: string;
}

export const PITCHES: Array<{ suffix: string; label: string }> = [
  { suffix: "#m20", label: "低沉" },
  { suffix: "#m10", label: "微沉" },
  { suffix: "", label: "原声" },
  { suffix: "#p10", label: "微亮" },
  { suffix: "#p20", label: "清亮" }
];

const LS_TAGS = "sr_edge_voice_tags_v1";

/** 预填的微软音色信息，供校对后覆盖保存 */
export function defaultVoiceTags(): Record<string, VoiceTag> {
  const t = (gender: string, age: string, name: string, dialect = "") => ({ gender, age, name, dialect });
  return {
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
}

export function loadVoiceTags(): Record<string, VoiceTag> {
  try {
    const raw = localStorage.getItem(LS_TAGS);
    if (!raw) return defaultVoiceTags();
    const parsed = JSON.parse(raw);
    return { ...defaultVoiceTags(), ...parsed };
  } catch {
    return defaultVoiceTags();
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
  const tag = tags[baseVoiceIdOf(voiceId)];
  const parts = [sourceName];
  if (tag) {
    if (tag.gender) parts.push(tag.gender);
    if (tag.age) parts.push(tag.age);
    if (tag.dialect) parts.push(tag.dialect);
  }
  return parts.join(" · ");
}
