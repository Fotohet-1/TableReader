# 剧本围读

上传剧本，自动拆出角色、预判性别和年龄段，按角色分配音色后分角色朗读。支持流式合成：满 25 句（或整剧不足 25 句时全部完成）即可提前进入围读，后台继续合成。

## 功能

- 上传 .docx / .txt / .md，或直接粘贴文本
- 行级解析：场标、对白、动作、旁白
- 角色写法归并（熊黑严肃 → 熊黑），规则预判性别，可选 DeepSeek 精修
- 两种 TTS：edge-tts 快速模式、本地 CosyVoice（支持上传音频克隆专属音色）
- 音色库：给每个 edge 中文音色打标签（性别、年龄、音色名、方言），5 档语调试听，支持批量打标和导出/导入
- 围读播放：当前句高亮、自动滚动、0.5x-3x 倍速、±5s/±10s 跳转、进度条拖动

## 启动

```bash
npm install
npm run dev
```

浏览器打开 http://127.0.0.1:5174/

TTS 是本地 HTTP 服务，需要先启动其中一个：

- edge-tts（推荐，快）：`/Users/hetan/Documents/剧本围读/edge-tts-tool/start.sh`，地址 `http://127.0.0.1:9882`
- 本地 CosyVoice（离线、可克隆）：`/Users/hetan/Documents/剧本围读/screenplay-reader-v8/local-tts/server_cosyvoice.py`，地址 `http://127.0.0.1:9880`

服务地址和 DeepSeek Key 都只存在浏览器 localStorage，不会上传。

## 音色库

工作台顶部打开“音色库”，14 个中文基础音色各一张卡：

- 每张卡有 5 个试听按钮（低沉/微沉/原声/微亮/清亮），点击即用当前试听文本合成
- 性别、年龄、音色名、方言（无则不填）都可在卡上直接改
- 勾选多张卡后，可用“批量”一次设置性别/年龄/方言
- “导出 JSON”下载当前标签，“导入 JSON”合并回浏览器

标签存在浏览器 localStorage，分配角色音色时，下拉会显示“晓晓 · 女 · 青年”这类带标签的名称，并可先按性别/年龄/方言筛选。

## 命令

```bash
npm run typecheck   # TypeScript 检查
npm run build       # tsc 检查 + 生产构建
npm run preview     # 预览构建产物
```

`scripts/e2e-check.mjs` 是浏览器端全流程检查脚本，需要 dev server 和一个带远程调试端口（默认 9223）的 Chrome。

## 结构

```text
src/lib/        解析、角色、音色、LLM、流式合成、TTS 适配
src/pages/      工作台与围读播放页
src/components/ 播放条
scripts/        浏览器端检查脚本
```
