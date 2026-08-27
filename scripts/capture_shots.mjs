/* 抓取最新版界面截图：首页 / 上传页 / 音色库
   需要 dev server 与带远程调试端口的 Chrome：
     CDP_URL=http://127.0.0.1:9223 PAGE_URL=http://127.0.0.1:5174/ node scripts/capture_shots.mjs
   输出目录可用 OUT_DIR 覆盖，默认 docs/核心功能与使用技巧/assets。 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const DEBUG = process.env.CDP_URL || "http://127.0.0.1:9223";
const PAGE_URL = process.env.PAGE_URL || "http://127.0.0.1:5174/";
const OUT_DIR = path.resolve(process.env.OUT_DIR || "docs/核心功能与使用技巧/assets");

const targets = await (await fetch(DEBUG + "/json")).json();
const page = targets.find((t) => t.type === "page");
if (!page) throw new Error("未找到 Chrome 页面目标: " + DEBUG);

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
await send("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});

async function evalJs(expression) {
  const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error("页面执行出错: " + JSON.stringify(res.exceptionDetails));
  return res.result.value;
}

async function waitFor(expression, timeoutMs = 30000, intervalMs = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await evalJs(expression)) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("等待超时: " + expression);
}

async function shot(name) {
  const res = await send("Page.captureScreenshot", { format: "png" });
  const out = path.join(OUT_DIR, name);
  await writeFile(out, Buffer.from(res.data, "base64"));
  console.log("saved", out);
}

try {
  await send("Page.navigate", { url: PAGE_URL });
  await new Promise((r) => setTimeout(r, 1800));
  await evalJs(`localStorage.setItem("sr_has_onboarded", "1"); localStorage.setItem("sr_tts_source", "edge"); true`);
  await send("Page.navigate", { url: PAGE_URL });
  await new Promise((r) => setTimeout(r, 2200));
  await waitFor(`document.querySelector(".home") !== null`);
  await mkdir(OUT_DIR, { recursive: true });
  await shot("sr_home_latest.png");

  await evalJs(`document.querySelector(".home").click(); true`);
  await waitFor(`document.querySelector(".choose-card") !== null`);
  await evalJs(`(() => { const b = [...document.querySelectorAll(".choose-card")].find((x) => x.textContent.includes("上传新剧本")); b && b.click(); return !!b; })()`);
  await waitFor(`document.querySelector(".upload-hero") !== null`);
  await new Promise((r) => setTimeout(r, 800));
  await shot("sr_upload_latest.png");

  await evalJs(`(() => { const b = document.querySelector(".lib-entry"); b && b.click(); return !!b; })()`);
  await waitFor(`document.querySelector(".lib-grid") !== null`);
  await new Promise((r) => setTimeout(r, 800));
  await shot("sr_library_latest.png");
} finally {
  ws.close();
}
