export interface LLMRoleProfile {
  name: string;
  gender: string;
  age: string;
  merged: string[];
}

function extractJson(s: string): string | null {
  const i = s.indexOf("{");
  const j = s.lastIndexOf("}");
  if (i < 0 || j <= i) return null;
  try {
    JSON.parse(s.slice(i, j + 1));
    return s.slice(i, j + 1);
  } catch {
    return null;
  }
}

/**
 * 调用 DeepSeek 做角色整理：合并同角色写法 + 预判性别/年龄。
 * 超时或格式异常时抛错，由调用方回退到规则结果。
 */
export async function analyzeRolesWithLLM(
  apiKey: string,
  rawNames: string[],
  scriptText: string
): Promise<{ profiles: LLMRoleProfile[]; mapping: Record<string, string> }> {
  const nameList = rawNames.join("、");
  const prompt =
    "你是剧本分析助手。以下是一部中文电视剧剧本中出现的所有台词说话人名称（可能含画外音标记、动作状态、组合等）：\n" +
    nameList +
    "\n\n剧本全文如下（节选）：\n" +
    scriptText.slice(0, 11000) +
    "\n\n任务：1) 将同一角色的不同写法合并（如 熊黑严肃 与 熊黑 是同一人；炎拓/熊黑 归为 炎拓；旁白类统一为 旁白）。" +
    "2) 判断每个最终角色的性别（男/女）与年龄段（少年/青年/中年/老年），无法判断写未知。" +
    "3) 只输出 JSON，格式：{\"角色名\": {\"gender\": \"男|女|未知\", \"age\": \"少年|青年|中年|老年|未知\", \"merged\": [\"原写法1\"]}}，不要输出任何其他文字。";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const resp = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json"
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 4000,
        temperature: 0.2,
        response_format: { type: "json_object" }
      })
    });
    if (!resp.ok) throw new Error("DeepSeek HTTP " + resp.status);
    const j = await resp.json();
    const content = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
    const jsonStr = extractJson(content);
    if (!jsonStr) throw new Error("LLM 返回格式异常");
    const data = JSON.parse(jsonStr);
    const profiles: LLMRoleProfile[] = Object.entries(data).map(([name, v]) => {
      const o = v as { gender?: string; age?: string; merged?: string[] };
      return {
        name,
        gender: o.gender || "未知",
        age: o.age || "未知",
        merged: Array.isArray(o.merged) ? o.merged : []
      };
    });
    const mapping: Record<string, string> = {};
    for (const p of profiles) {
      for (const m of p.merged) mapping[m] = p.name;
    }
    for (const n of rawNames) if (!mapping[n]) mapping[n] = n;
    return { profiles, mapping };
  } finally {
    clearTimeout(timer);
  }
}

/** 让 DeepSeek 根据角色信息和代表台词写一段声音描述 */
export async function describeRoleVoice(
  apiKey: string,
  role: { name: string; gender?: string; age?: string; lines?: number },
  samples: string[]
): Promise<string> {
  const prompt =
    "你是影视剧声音指导。为一个角色设计声音，只输出一段中文声音描述（40 字以内），" +
    "要包含性别、年龄感、音色、语气和情绪底色，不要解释。\n\n角色信息：\n" +
    "名字：" + role.name + "\n" +
    "性别：" + (role.gender || "未知") + "\n" +
    "年龄段：" + (role.age || "未知") + "\n" +
    "台词量：" + (role.lines || 0) + " 句\n" +
    "代表台词：\n" + samples.join("\n").slice(0, 400);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const resp = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json"
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 200,
        temperature: 0.8
      })
    });
    if (!resp.ok) throw new Error("DeepSeek HTTP " + resp.status);
    const j = await resp.json();
    const content = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
    const clean = content.replace(/^["'“”\s]+|["'“”\s]+$/g, "").trim();
    if (!clean) throw new Error("DeepSeek 返回空描述");
    return clean;
  } finally {
    clearTimeout(timer);
  }
}

/** 校验 DeepSeek Key 是否有效 */
export async function checkDeepSeekKey(apiKey: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch("https://api.deepseek.com/models", {
      headers: { "Authorization": "Bearer " + apiKey },
      signal: controller.signal
    });
    return resp.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
