const FEMALE_TITLES = ["姐", "妈", "姨", "婶", "姑", "婆", "奶", "阿姨", "女士", "姑娘", "妹", "女", "小姐", "娘子", "夫人", "太太", "娘"];
const MALE_TITLES = ["哥", "爸", "叔", "伯", "舅", "爷", "公", "先生", "男", "汉", "郎"];
const FEMALE_CHARS = "芳丽娟婷静燕霞琳雪花香凤玉珠梅兰菊美娜慧敏淑珍艳红秀蓉薇莲萍莹洁颖佳婉芸茜荷蕊蝶莺娥露瑶姝妍芷萱采薇伊璐彤雪晴琪玥璇茹芊怡梦雨欣诗语心怡馨嘉若曦曼筠澜汐栀虞绡凝婉姝";
const MALE_CHARS = "强军伟刚磊涛斌明华平志龙海波林峰浩宇杰俊凯鹏飞翔建国东震生荣富贵才勇毅超阳天铭睿泽昊晨皓锐锋勇彪鑫森虎宏博轩然子宇航皓驰靖昊霆帆翼勋毅泽楷铭扬骏瑞";

export function guessGender(name: string): "男" | "女" | "未知" {
  if (FEMALE_TITLES.some((t) => name.includes(t))) return "女";
  if (MALE_TITLES.some((t) => name.includes(t))) return "男";
  const last = name[name.length - 1] || "";
  if (FEMALE_CHARS.includes(last)) return "女";
  if (MALE_CHARS.includes(last)) return "男";
  return "未知";
}

/** edge-tts 音色默认值：按性别和年龄段映射到合适的微软音色 */
export function defaultEdgeVoiceFor(p: { name: string; gender?: string; age?: string }): string {
  if (p.name === "旁白") return "zh-CN-XiaoxiaoNeural";
  const g = p.gender === "男" ? "男" : "女";
  const a = p.age || "";
  if (g === "男") {
    if (a === "儿童" || a === "少年") return "zh-CN-YunxiaNeural";
    if (a === "中年" || a === "老年") return "zh-CN-YunjianNeural";
    return "zh-CN-YunxiNeural";
  }
  if (a === "儿童" || a === "少年") return "zh-CN-XiaoyiNeural";
  return "zh-CN-XiaoxiaoNeural";
}

/** 无 DeepSeek Key 时的规则声音描述模板 */
export function defaultVoiceDescFor(p: { name: string; gender?: string; age?: string }): string {
  const g = p.gender === "男" ? "男声" : "女声";
  const age = p.age && p.age !== "未知" ? p.age : "中年";
  const pitch =
    age === "少年" ? "音色清亮、偏高" :
    age === "老年" ? "音色沉稳、略沙哑" :
    age === "青年" ? "音色自然清晰" :
    "音色沉稳克制";
  const mood = p.name === "旁白" ? "语气冷静、带叙述感" : "语气自然生活化";
  return `【性别 ${g}，年龄 ${age}，音调 ${pitch}，语速 匀速，情感 ${mood}，质感 吐字清晰】`;
}
