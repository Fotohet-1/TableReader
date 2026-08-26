/* 浏览器端全流程检查：需要本地 dev server 与带远程调试端口的 Chrome */
const DEBUG = process.env.CDP_URL || "http://127.0.0.1:9223";
const PAGE_URL = process.env.PAGE_URL || "http://127.0.0.1:5174/";

const targets = await (await fetch(DEBUG + "/json")).json();
const page = targets.find((t) => t.type === "page");
if (!page) throw new Error("未找到 Chrome 页面目标");

const ws = new WebSocket(page.webSocketDebuggerUrl);
let msgId = 0;
const pending = new Map();

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message));
    else p.resolve(msg.result);
  }
};

await new Promise((r) => { ws.onopen = r; });
await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url: PAGE_URL });
await evalJs(`localStorage.setItem("sr_has_onboarded", "1"); localStorage.setItem("sr_tts_source", "edge")`);
await send("Page.navigate", { url: PAGE_URL });
await new Promise((r) => setTimeout(r, 2500));

async function evalJs(expression) {
  const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) {
    throw new Error("页面执行出错: " + JSON.stringify(res.exceptionDetails));
  }
  return res.result.value;
}

async function waitFor(expression, timeoutMs = 60000, intervalMs = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await evalJs(expression)) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("等待超时: " + expression);
}

const clickByText = (text) =>
  evalJs(`(() => {
    const el = [...document.querySelectorAll("button")].find((b) => b.textContent.includes(${JSON.stringify(text)}));
    if (!el) return false;
    el.click();
    return true;
  })()`);

await waitFor(`document.querySelector(".home") !== null`, 10000);
await evalJs(`document.querySelector(".home").click()`);
await waitFor(`document.querySelector(".upload-hero") !== null`, 10000);

await clickByText("或者，粘贴剧本原文");
const sampleOk = await clickByText("填入示例");
const textLen = await evalJs(`document.querySelector("textarea") ? document.querySelector("textarea").value.length : 0`);
console.log("填入示例:", sampleOk, "字数:", textLen);

await clickByText("解析剧本");
await waitFor(`[...document.querySelectorAll(".card h2")].some((h) => h.textContent.includes("场标预览"))`, 30000);
await clickByText("确认场标，进入角色确认");
await waitFor(`document.querySelector(".cv-row .cv-name") !== null`, 30000);
const roles = await evalJs(`[...document.querySelectorAll(".cv-row .cv-name")].map((e) => e.textContent)`);
console.log("解析角色:", roles.join("、"));

await clickByText("确认并分配音色");
await waitFor(`document.querySelector(".cv-row select") !== null`, 15000);
const voices = await evalJs(`[...document.querySelectorAll(".cv-row select")].map((s) => s.value)`);
console.log("分配音色:", voices.join("、"));

await clickByText("开始合成");
await waitFor(`document.querySelector(".enter-box") !== null`, 90000);
const ready = await evalJs(`document.querySelector(".enter-box span") ? document.querySelector(".enter-box span").textContent : ""`);
console.log("提前进入条件:", ready);

await waitFor(`[...document.querySelectorAll(".prog")].some((e) => e.textContent.includes("合成完成"))`, 120000);
const summary = await evalJs(`[...document.querySelectorAll(".prog")].find((e) => e.textContent.includes("合成完成")) ? [...document.querySelectorAll(".prog")].find((e) => e.textContent.includes("合成完成")).textContent : ""`);
console.log("合成结果:", summary);

await evalJs(`(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("进入围读"));
  if (btn) btn.click();
  return !!btn;
})()`);
await waitFor(`document.querySelector(".player-bar") !== null`, 15000);
const units = await evalJs(`document.querySelectorAll(".unit").length`);
const barText = await evalJs(`document.querySelector(".tb-info") ? document.querySelector(".tb-info").textContent : ""`);
console.log("围读页单元数:", units, "状态:", barText);

ws.close();
console.log("E2E OK");
