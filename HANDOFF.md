# TableReader · 维护更新交接文档（2026-08-29）

> 给新开的维护对话。先读这份，再看 `README.md`、`复盘总结-part1.md`、`复盘总结-part2.md`、`git log --oneline`。

## 项目现状

剧本围读本地工具，已开源并完成外发：

- GitHub 仓库：https://github.com/Fotohet-1/TableReader（公开，MIT）
- 产品页：https://fotohet-1.github.io/TableReader/
- 正式外发包：`/Users/hetan/Documents/剧本围读外发/TableReader-正式版-v1.0.0.zip`
- 一句话：上传剧本 → 自动拆角色/场次/对白 → 一句话描述音色（Qwen 本地种子）或 edge 在线 → 流式合成 → 分角色围读 → 存档续读

主推路线是 **Qwen 本地部署 + 自然语言描述音色**：全本地、离线可用、跨集声音统一；edge-tts 只是快速试听备选。

## 本机当前状态

- 分支 `main`，HEAD `7768447`（复盘总结 part2）；工作区只剩 `?? xhs/` 未跟踪。
- `xhs/`（约 3.8MB）是小红书调研/图文，**用户要求不上仓库**，git 操作时不要 add 它。
- 四个服务当前都在跑：5174 前端、9882 edge、9883 Qwen、9884 存档。
- 服务健康：5174 `/` 200；9883 `/health` 200；9884 `/health` 200；9882 在监听但无 `/health`，根路径 404 属正常。

## 启动 / 常用命令

```bash
bash scripts/start_all.sh        # 一键启动四服务（内部用 scripts/detach.py 脱离会话）
npm run dev                      # 开发模式前端（5174）
npm run typecheck && npm test && npm run build
```

注意：仓库里的启动命令实际是 `scripts/start.command`；README 里写的 `./start.command` 是给外发包用户的简化说法，本机根目录没有该文件。维护时如顺手，可把 README 改精确。

## 服务与端口

| 端口 | 服务 | 启动方式 |
|---|---|---|
| 5174 | 前端 | 外发用 `python3 scripts/server_web.py`（托管 dist/）；开发用 `npm run dev` |
| 9882 | edge-tts | `./.venv-edge/bin/python scripts/server_edge_tts.py` |
| 9883 | Qwen3 1.7B | `./.venv-qwen/bin/python scripts/server_qwen_tts.py`，**必须用 venv Python** |
| 9884 | 存档服务 | `python3 scripts/server_archive.py`（stdlib） |

## 关键坑（新对话必读）

1. **Qwen 必须用 venv Python**：`/Users/hetan/Documents/剧本围读/qwen3-tts-test/.venv/bin/python`。用框架 Python 启动会让 `/tts` 报 `ModuleNotFoundError: mlx_audio`，前端生成音色 500；`/health` 测不出来，验证要真打一次 `/tts`。
2. **服务要脱离会话启动**，否则 exec 结束被回收：`scripts/start_all.sh` 已用 `scripts/detach.py`（`start_new_session=True`）处理。不要用 `nohup ... &`。
3. **存档目录懒创建**：默认 `~/Documents/剧本围读存档`，第一次保存/合成时 `os.makedirs` 才建。给别人用＝他自己的空存档；共享存档需手动拷整个文件夹。
4. **Qwen 偶发挂起**：历史上反复生成时可能卡住（0% CPU）。现已改为**单一 worker 线程**串行调模型，配合 acquire 超时 + 重建 worker，不会永久占死。若再复现，优先怀疑模型实例复用/线程交互。

## 近期产品决策（维护时不要改回去）

- 默认浅色模式；浅色匹配 Codex 浅色（页面 `#fcfcfc`、卡片 `#ffffff`）；深色匹配 Codex 聊天框（`#181818` / 表面 `#222222` / 分割线 `#2a2a2a`）。
- 首页只能点“开始使用”按钮进入，整页不可点。
- 首页底部签名 `Made by 河忐`；设置弹窗 `v1.0.0` + `Made by 河忐`；版本常量 `APP_VERSION = "v1.0.0"` 在 `src/lib/settings.ts`，正式外发前保持不变。
- 存档目录 UX：去掉绿点；只读输入框点击唤起文件夹选择；路径失效显示红色“路径丢失，请重新设置”；存档服务有 `/check-dir`、`/pick-dir`。
- 主推 Qwen：卡片、文案、产品内均以“一句话描述音色 + 本地生成种子”为主线。

## 小红书侧（xhs/，不进仓库）

- 内容都在 `xhs/table-reader/`：调研总结、发布文案、5 张 3:4 图文卡片（`cards/png/`）、大赛参赛评估。
- 改卡片文案后重新出图：
  - `node xhs/table-reader/cards/_shoot.mjs` 出五张卡
  - `_shot_ui.mjs` 抓产品页面整图，`_shot_subjects.mjs` 抓主体元素截图
  - 截图依赖 5174 dev server 在跑
- 卡片当前样式：宋体系字体、P1/P3 主体取景约 1.5x、衬底四边 13px 等宽、P5 右下角落款 `Made by 河忐`。
- 小红书 vibe coding 大赛：投稿截至 2026.9.7，参赛载体是“小红书小工具”（网页点开即用），TableReader 本体不能直接参赛，需网页 demo（评估见 `xhs/table-reader/research4/`）。

## 架构要点

- 两级存档（剧 → 集）+ 剧级音色库；`mergeVoiceBanks` 合并不覆盖；音源锁在剧级。
- `roleBase` 跨集稳定身份键；解析器在 `src/lib/parser.ts`；系列识别 `src/lib/series.ts`。
- 深色主题 `src/lib/theme.ts`，三态 system/light/dark，`data-theme` 挂 `<html>`。
- TTS 前端硬超时（edge 60s、Qwen 120s）在 `src/lib/tts.ts`。
- 最大文件：`src/pages/UploadPage.tsx`（约 1330 行）、`src/index.css`（约 1230 行）。

## 验证

- `npm run typecheck` 零报错
- `npm test` 34/34（解析/角色/系列/声音模板/确认页排序/音色合并）
- `npm run build` 通过
- 浏览器 e2e：`CDP_URL=http://127.0.0.1:9225 PAGE_URL=http://127.0.0.1:5174/ node scripts/e2e-check.mjs`（需 Chrome 远程调试 9225）

## Git 约定

- 一直在 `main`，每次改动后 `git commit`（用户要求）。
- 不要 `git add xhs/`；不要 revert 用户已有改动。
- 外发目录统一用 `TableReader-正式版-v1.0.0.zip`；旧的 `剧本围读助手-*` 包已过时，不要再分发。

## 待办 / 开放项

- Qwen 偶发挂起：单 worker 已上线，继续观察，必要时子进程隔离 + 强杀。
- GitHub Pages 无内置访客统计，用户想接第三方（GoatCounter / Cloudflare Analytics）。
- README `./start.command` 与 `scripts/start.command` 路径表述不一致。
- `index.css` 有未使用的 `--dark` 变量；`svc-dot` 三个状态色仍是硬编码。
- 小红书发布还没执行（卡片、文案已就绪）。

## 协作约定（用户偏好）

- 用户已建 skill `project-dev-sop`：新项目/维护按“功能架构 → UI 打磨 → 打包外发”三阶段；问题随手记录并分类进 backlog，当前阶段只处理当前阶段问题；每阶段结束做复盘。
- 中文沟通；解释先类比后术语；避免“不是……而是……”句式。
- 改 UI 后看真实渲染/截图，不只信计算样式；改数据前先想旧数据兼容。
