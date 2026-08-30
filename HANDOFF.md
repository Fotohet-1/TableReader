# TableReader 交接文档

> 给下一个 Codex 会话的当前状态快照。接手后先从本文件、`README.md`、`复盘总结-part1.md` / `复盘总结-part2.md` 读起，再按需展开源码。

## 项目现状

TableReader 是一个本地剧本围读工具：上传剧本、拆角色/场次/对白，给每个角色配置音色，流式合成对白，进入分角色围读页播放，存档后可继续围读，并在整集音频齐全后按播放器时间轴拼成一条完整音频。

- 工作目录：`/Users/hetan/Documents/ChatGPT/剧本围读Codex`
- 仓库：`https://github.com/Fotohet-1/TableReader`
- 产品页：`https://fotohet-1.github.io/TableReader/`
- 分支：`main`，当前 HEAD：`978821e fix: 存档页进入不闪、展开无载入中闪烁`
- 当前版本：`v1.1.0`。`package.json` 和 `src/lib/settings.ts` 里的 `APP_VERSION` 都还没升版本，后续功能整理完再统一升版本。
- 当前工作树：旧 `HANDOFF.md` 已删除待重写；`xhs/` 未跟踪且刻意不提交。

## 启动与端口

一键启动所有服务：

```bash
cd /Users/hetan/Documents/ChatGPT/剧本围读Codex
bash scripts/start_all.sh
```

前端开发：

```bash
npm run dev
```

| 服务 | 端口 | 说明 |
| --- | --- | --- |
| 前端 | 5174 | Vite，或由 `scripts/server_web.py` 服务 `dist/` |
| edge-tts | 9882 | 在线音色 |
| Qwen3 | 9883 | 本地音色，需要 venv Python 和模型 |
| 存档服务 | 9884 | 两级存档、整集拼接、删除、访达显示 |

Qwen 的启动路径有回退逻辑：优先用仓库内 `models/` 和 venv，找不到再回退到：

- venv Python：`/Users/hetan/Documents/剧本围读/qwen3-tts-test/.venv/bin/python`
- VoiceDesign 模型：`/Users/hetan/Documents/剧本围读/qwen3-tts-test/models/Qwen3-TTS-12Hz-1.7B-VoiceDesign-5bit`
- Base 模型：`/Users/hetan/Documents/剧本围读/qwen3-tts-test/models/Qwen3-TTS-12Hz-1.7B-Base-4bit`

服务通过 `scripts/detach.py` 脱离当前会话启动，日志在 `logs/sr_*.log`。

## v1.1.0 之后的关键改动

### 功能

- 参考音频克隆：声音设计页支持上传参考音频、填参考文本、试听克隆；参考音频会先在浏览器解码并归一化成 PCM WAV，再交给 Qwen，避免 m4a 无法解析。
- 音量自动配平：合成前按 RMS 归一，参考克隆音色不再明显偏小。
- 整集完整音频：每集合成齐全后按播放器时间轴拼接，同 group 的重叠与句间隔都照搬播放器时间轴，导出效果等于应用内播放。文件路径为 `{存档工作区}/{剧集}/{集}/{剧名} {集名} 完整音频.wav`。
- 整集音频角标：右上角状态点从“生成进度”收敛到“整集音频已生成 / 正在生成 / 可生成 / 失败”；完成态可点击，在访达中显示。
- 继续围读自动补齐：打开旧集时只合成缺失对白，不整集重跑。
- 存档删除：项目和集都支持删除，弹窗警告不可逆。
- DeepSeek API 存在时，“解析剧本”显示为“AI 解析剧本”。

### 稳定性与竞态

- Qwen 模型生成迁移到独立子进程 `scripts/server_qwen_worker.py`，stdout 只输出 JSON 协议；`scripts/server_qwen_tts.py` 超时强杀子进程并重建。
- 增加 Qwen `/status`，默认超时从 180s 收到 90s；前端在 Qwen 忙超过 60s 时显示“生成中（可能异常）”。
- 重生成竞态加固：共享 `voiceMapRef`，后台合成实时读取最新音色；共享 `regenClaimedRef` 和 `regenInProgressRef`，重生成期间后台合成跳过已认领台词；整集拼接等待重生成全部替换完成后再执行。
- 整集音频判定收紧：`full_audio_status` 用 `exists/complete/stale/missing` 区分，只有每个文本对白都有 WAV 才自动拼接，中间态不会误报“生成失败”。

### 界面与交互

- 存档选择项目页：卡片居中偏上，展开/收起时通过 `ResizeObserver` 做丝滑位移动画；项目多时整页滚动；进入首帧不闪，展开不再先出现“载入中”。
- 存档页顶栏改成“音源下拉 + 状态点 + 设置”，设置弹窗抽成共享组件 `src/components/SettingsModal.tsx`。
- 深浅色模式按钮颜色统一。
- 存档页按 Apple 设计手册优化，手册在 `/Users/hetan/Downloads/awesome-design-md-apple/DESIGN.md`。
- 点剧可展开集，再点收起；标题“选择剧集”已改为“选择项目”。
- 项目按钮等宽右对齐，文字左对齐、日期右对齐，去掉音色和日期之间的隔断点。

## 架构要点

- 前端：React + Vite + TypeScript，主要页面 `UploadPage`、`PlayerPage`、`ArchiveContinuePage`。
- `src/App.tsx` 是状态机中枢，持有 `voiceMapRef`、`regenClaimedRef`、`regenInProgressRef`，并在合成完成与重生成完成后触发整集拼接。
- `src/lib/synth.ts`：流式合成。
- `src/lib/resume.ts`：继续围读补齐缺失对白。
- `src/lib/archive.ts`：存档 API，含 `/stitch`、`/reveal`、`/full-audio-info`、删除接口。
- `scripts/server_archive.py`：两级存档结构 `剧集 -> 集`，以及整集 WAV 拼接。

## 验证

```bash
cd /Users/hetan/Documents/ChatGPT/剧本围读Codex
npm run typecheck
npm test
npm run build
```

服务健康检查：

```bash
bash scripts/start_all.sh
curl -s -X POST http://127.0.0.1:9882/health
curl -s -X POST http://127.0.0.1:9883/health
curl -s -X POST http://127.0.0.1:9884/health
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5174/
```

## 待办与观察

- Qwen 偶发挂起已用子进程超时重建缓解，仍需在真实长剧集里观察日志 `logs/sr_qwen.log`。
- 重生成竞态已加固，极端窄窗口“边合成边重生成”仍建议做一轮真实回归测试。
- 后续功能整理完成后再统一升版本号，并更新 `package.json`、`src/lib/settings.ts`、README、产品页。
- 旧命名 `完整音频.wav` 已弃用，新命名不认旧文件；如工作区还有旧孤儿文件，删掉即可，不影响新文件。

## 协作约定

- 默认每完成一步提交一次 git；`xhs/` 永远不 `git add`。
- 复杂逻辑先沟通再动手；用户说“执行”后直接做，不再重复确认。
- 测试以真实浏览器、Playwright 和实际渲染为准，不只相信计算样式。
- 中文沟通；解释时先用生活类比，再给术语；避免“不是……而是……”句式。
