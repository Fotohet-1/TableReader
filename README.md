# 剧本围读

上传剧本，自动拆出角色、预判性别和年龄段，按角色分配音色后分角色朗读。支持流式合成：满 25 句（或整剧不足 25 句时全部完成）即可提前进入围读，后台继续合成。

## 功能

- 上传 .docx / .txt / .md，或直接粘贴文本
- 行级解析：场标、对白、动作、旁白
- 角色写法归并（熊黑严肃 → 熊黑），规则预判性别，可选 DeepSeek 精修
- 两种 TTS：edge-tts 快速模式、本地 CosyVoice（支持上传音频克隆专属音色）
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
