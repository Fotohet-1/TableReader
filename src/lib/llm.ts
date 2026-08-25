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
