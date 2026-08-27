# 剧本围读助手 · 交接文档

> 给接手的新对话/开发者。先读这份，再看 `README.md`、`AGENT_SETUP.md`、`git log --oneline`。

## 项目是什么

Vite + React + TS 的本地“剧本围读”应用 + 3 个 Python 本地服务。上传剧本 → 解析角色/场次 → 分配音色 → 合成配音 → 分角色朗读。TTS 走本地服务，音频落盘可续读。已实现**剧集级音色复用**（跨集角色音色统一）、**深色模式**、**跨集存档**。

## 当前流程

1. 首页 →“开始使用”→ 选择页（上传新剧本 / 继续围读）。
2. 上传页（.docx/.txt/.md，可多选）→ 顶部细条（返回 / 音源 qwen|edge / 音色库 / 设置）。上传后自动识别剧名。
3. 场标预览 → 确认角色（男/女 + 年龄下拉 + “多种表述”变体）。**排序：无音色种子（新角色）在前、可复用（有种子）在后，各自按台词句数降序**。
4. Qwen：声音设计（描述、试听、固定音色）→ 角色与音色；Edge：直接分配音色。
5. 合成（流式，满 25 句可提前进围读）→ 进入围读页。Esc 保存并返回，空格播放/暂停，右上角 iOS 开关切深浅色。
6. “继续围读”→ 两级：先选剧集（项目）再选集。

## 服务与端口（四服务，均需在跑）

| 端口 | 服务 | 说明 |
|---|---|---|
| 5174 | 前端 | 外发版用 `python3 scripts/server_web.py`（托管 `dist/`）；开发用 `npm run dev` |
| 9882 | edge-tts | `./.venv-edge/bin/python scripts/server_edge_tts.py`（退回老机器绝对路径） |
| 9883 | Qwen3 1.7B | `./.venv-qwen/bin/python scripts/server_qwen_tts.py`，**必须用 venv Python**，见下“坑” |
| 9884 | 存档服务 | `python3 scripts/server_archive.py`（stdlib 即可） |

## ⚠️ 关键“坑”（新对话必读）

1. **Qwen 必须用 venv Python**：`/Users/hetan/Documents/剧本围读/qwen3-tts-test/.venv/bin/python`。若用框架 Python（`/opt/homebrew/Cellar/python@3.11/.../Python`）启动，`/tts` 会 `ModuleNotFoundError: mlx_audio`，前端“生成音色”报 500。
2. **服务要用“脱离开会话”的方式启动**，否则 exec 结束会被回收。`scripts/start_all.sh` 现在用 `nohup + disown` 处理；若自己用 Python 拉起，仍要 `start_new_session=True`：
   ```python
   subprocess.Popen([py, "scripts/server_qwen_tts.py"],
       stdout=open("/tmp/sr_qwen.log","wb"), stderr=subprocess.STDOUT,
       stdin=subprocess.DEVNULL, start_new_session=True)
   ```
3. **存档目录不是启动建的**，是第一次“保存/合成”时由存档服务 `os.makedirs` 懒创建。默认路径 `~/Documents/剧本围读存档`（`expanduser` 解析成用户自己的家目录）。**给别人用＝他自己的空存档，不会带走你的存档**；想共享存档需手动拷 `~/Documents/剧本围读存档` 整个文件夹给对方。
4. **Qwen 服务偶发挂起**：历史现象是反复生成时（尤其第二次请求）可能卡住（0% CPU，模型隔离测试正常，仅 HTTP 服务偶发）。现已改成**单 worker 线程**：模型加载/生成只在固定线程里串行执行，避免 MLX 模型实例跨线程复用；某次生成超时（默认 180s，`QWEN_JOB_TIMEOUT` 可调，兼容旧名 `QWEN_ACQUIRE_TIMEOUT`）会重建 worker，不会永久占死队列。若再复现，优先怀疑模型实例复用，其次才是线程竞争。

## 架构要点

### 两级存档（剧 → 集）+ 剧集音色库
```
{存档目录}/{剧名}/
  project.json      # 剧集元数据: id/name/source/episodes[]
  音色/bank.json    # 跨集音色库，按 roleBase 角色身份键索引
  音色/seeds/{角色}.wav  # Qwen 种子音频
  {集}/project.json # 该集剧本结构(只写一次)
  {集}/meta.json    # 该集音频+播放进度
  {集}/audio/{unit}.wav
```
- 音源锁在剧级：同剧不同音源的复用会跳过。
- 音色库**合并**而非整库替换（`mergeVoiceBanks`），保证前几集角色不丢。

### 解析器（`src/lib/parser.ts`）
- `roleBase`：跨集稳定身份键，剥头衔/OS/括注/情绪/状态片刻，保证 `聂九罗 董事长→聂九罗`。
- `isPersona`：过滤“字幕/画面/内容/第一张”等非人描述行。
- 剥“对X”称谓、`僵住/迟疑片刻` 等状态尾缀。

### 系列识别（`src/lib/series.ts`）
- `seriesKeyFromFile` 从文件名剥 集标/注解/稿次/版本/日期，抽出剧名；`slugify` 做安全剧集 id。

### 深色模式（`src/lib/theme.ts`）
- 三态 `system|light|dark`，默认跟系统，localStorage 持久化，`data-theme` 挂在 `<html>`。
- Apple 系深色（黑底/深卡片/浅字/蓝 accent `#0a84ff`），大量硬编码颜色已抽成 CSS 变量（`--bar-frost`/`--select-arrow`/`--mask`/`--fill-*`/`--border-*`/`--shadow-card` 等）。
- 设置面板“外观”= 分段控件；围读页顶部 = iOS 滑块开关（点它会把“跟随系统”切到显式浅/深，回系统要去设置）。

### TTS
- 前端所有 TTS 调用带硬超时（edge 60s、Qwen 120s），`src/lib/tts.ts`。
- Qwen 服务 `server_qwen_tts.py`：信号量（上限=池大小 1）+ `acquire` 超时 + 成功/异常都释放。

## 关键文件

- `src/pages/UploadPage.tsx`（上传/解析/确认角色/声音设计/合成/设置/音色库，约 1330 行，最大）
- `src/pages/PlayerPage.tsx`（围读页，时间槽驱动、联动说话、重生成音色、iOS 开关）
- `src/lib/parser.ts`、`roles.ts`、`series.ts`、`tts.ts`、`synth.ts`、`archive.ts`、`theme.ts`、`settings.ts`、`voiceTags.ts`、`voices.ts`
- `scripts/server_archive.py`（两级存档+音色库接口）、`server_qwen_tts.py`、`server_edge_tts.py`
- `src/index.css`（约 1230 行，大量主题变量）

## 验证

```bash
npm run typecheck   # 零报错
npm test            # 34/34（解析/角色/系列/声音模板/确认页排序/音色合并）
npm run build       # 通过；mammoth/jszip 懒加载
```

浏览器端 e2e：`CDP_URL=http://127.0.0.1:9225 PAGE_URL=http://127.0.0.1:5174/ node scripts/e2e-check.mjs`（需 Chrome 远程调试 9225，页面目标丢失时先 `curl -X PUT "http://127.0.0.1:9225/json/new?http://127.0.0.1:5174/"`）。

## Git

- 当前分支 `main`，工作区干净。最新提交 `c248f08`（上传页设置弹窗与上传卡片中心对齐）。
- 最近 10 个提交覆盖：跨集音色复用、解析器增强、安全限流、测试、深色模式、主题细则、倍速乘号、弹窗对齐。
- 每次改动后均已 `git commit`（用户要求：以后每次改动都 git）。

## 外发相关（下个会话重点）

- 应用是“本地工具 + 3 个本地 Python 服务”，外发需打包这几部分（前端 build 产物 + 三个 server + 各自 venv/模型/edge 依赖 + 模型路径）。
- 外发入口：`setup.command`（一键安装 venv + 从 hf-mirror 拉 Qwen 模型）+ `start.command`（一键启动），接收方说明见 `外发说明.md`。
- 接收方若由 AI agent 代装，把 `AGENT_SETUP_RECIPIENT.md` 交给对方 agent 执行。
- Qwen 模型默认取仓库内 `models/`，可用 `QWEN_VD_MODEL`/`QWEN_BASE_MODEL` 覆盖；并发池 `QWEN_DESIGN_POOL`/`QWEN_CLONE_POOL`、生成超时 `QWEN_JOB_TIMEOUT`。
- 存档目录按用户懒创建（见上“坑”3），外发时对方拿到的默认就是自己的空存档。
- 想让你之外的人看到你的存档，需手动拷贝 `~/Documents/剧本围读存档`。
