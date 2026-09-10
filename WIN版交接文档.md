# TableReader Windows 版交接文档

> 给 Windows 电脑上的 Codex 会话。接手后先读 `README.md`、`HANDOFF.md`、本文件，再按需展开源码。目标是做出一个完整的 Windows 版 TableReader，Qwen 本地合成跑在 NVIDIA 4060 上。

## 一、任务目标

- 移植到 Windows，交付一个"解压即可用"的完整包：双击启动后自动拉起前端、edge-tts、Qwen 合成、存档服务。
- Qwen 用 Windows 本机 NVIDIA GPU（RTX 4060，8GB 显存）跑 CUDA 推理，保留 VoiceDesign 音色设计、参考音频克隆、角色固定音色、重生成这些现有能力。
- 优先满足用户自己那台 4060 电脑；跑通后再考虑对外分发。
- 前端、剧本解析、存档逻辑尽量复用，不要重写。

## 二、现状快照

TableReader 是本地剧本围读工具：上传剧本 → 拆角色/场次/对白 → 配置音色 → 合成 → 分角色围读 → 存档续读 → 整集音频拼接。

- 技术栈：React + Vite + TypeScript 前端（`dist/` 是生产构建），Python 本地服务。
- 端口：前端 5174、edge-tts 9882、Qwen3 9883、存档服务 9884。
- 当前 Mac 版 v1.2.3，已包含：拆行场标识别（火旺剧本 23 集 607 场验证通过）、多文件上传逐集独立存档、Qwen 种子文本自动挑选约 8-10 秒的稳定台词、围读页顶栏显示当前文件名称。
- 工作目录按 Windows 接手时解压到的位置为准；`README.md` 和 `HANDOFF.md` 里有 Mac 版完整说明，可对照参考。

## 三、Windows 必改清单

### 3.1 Qwen 本地 TTS（核心难点）

现状：

- `scripts/server_qwen_tts.py` + `scripts/server_qwen_worker.py` 使用 `mlx_audio`，只支持 Apple Silicon，Windows 上不可用。
- 模型是 `mlx-community/...-5bit` / `...-4bit` 的 MLX 量化版，Windows 不能直接用。

目标：

- 改用 `transformers` + CUDA 版 PyTorch，跑官方非 MLX 权重：
  - `Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign`（音色设计）
  - `Qwen/Qwen3-TTS-12Hz-1.7B-Base`（参考音频克隆）
- 保持 HTTP 协议不变，前端零改动（协议见第四节）。
- 保留现有"子进程跑模型 + 超时强杀重建"模式，避免模型挂起卡死整条合成。
- 4060 8GB 建议 bf16，必要时量化或 CPU offload；社区实测 10 秒语音约 2-3 秒出。

可参考的现成 Windows 方案：

- `qwen-tts` pip 包 + `transformers` + `torch`（官方模型卡推荐路线）
- 社区 Windows GUI/API 项目（Qwen3-TTS-GUI、Qwen3-TTS-API 等）
- OpenVINO / ONNX 社区运行时

### 3.2 存档服务的系统调用

`scripts/server_archive.py` 里有 macOS 专属调用，要换成 Windows 等价物：

- 选目录：`osascript choose folder` → PowerShell 文件夹选择框或 `tkinter.filedialog.askdirectory`
- 打开目录：`open path` → `explorer path`
- 显示文件：`open -R path` → `explorer /select,<path>`

路径统一用 `pathlib`，不要写死 POSIX 风格。`/tmp/...` 这类临时目录要换成 `tempfile.gettempdir()`。

### 3.3 安装、启动、打包

现状是 macOS 脚本：

- `setup.command` → `scripts/setup.sh`（检查 Apple Silicon、装 venv、下载模型）
- `start.command` → `scripts/start_all.sh`（拉起四个服务并开浏览器）
- `scripts/detach.py`（`start_new_session=True` 是 POSIX 专属，Windows 要改 `creationflags`）
- `scripts/make_app.sh` / `scripts/package_release.py`（Mac 打包）

Windows 要新建：

- `setup_win.ps1`：检查 `nvidia-smi`；创建 Python 3.10/3.11 venv；装 CUDA 版 torch、`qwen-tts`、`transformers`、`edge-tts`、`soundfile`、`huggingface_hub`；从 hf-mirror 下载两个模型（约 8-10GB）。
- `start_win.bat`：按端口启动四个服务、写日志、打开浏览器；已运行端口自动跳过。
- 可选 `package_win.ps1`：打 portable zip 或用 Inno Setup 生成安装器。

### 3.4 前端

- `dist/` 已是最新生产构建，Windows 直接由 `scripts/server_web.py` 服务即可。
- 一般不需要改 `src/`；如果改了，Windows 上执行 `npm install && npm run build`。

## 四、HTTP 协议（必须保持兼容）

Qwen 服务与前端通过以下接口通信，Windows 实现要原样保留：

```text
POST /tts
body: {"text": "...", "instruct": "声音描述"}
resp: audio/wav

POST /tts-clone
body: {"text": "...", "audio_b64": "...", "ref_text": "..."}
resp: audio/wav

POST /health
resp: {"ok": true}

GET /status
resp: {"ok": true, "design": {...}, "clone": {...}, "timeoutSec": ...}
```

前端调用在 `src/lib/tts.ts`（`qwenSynthOne` / `qwenCloneSynthOne`），设置里可改 Qwen 地址（默认 `http://127.0.0.1:9883`）。

## 五、环境与依赖建议

- Python 3.10 或 3.11。
- NVIDIA 驱动 + CUDA 版 PyTorch（用 pip wheel 即可，不必装完整 CUDA Toolkit）。
- `edge-tts` 路线不依赖显卡，Windows 上直接可用。
- 下载 HuggingFace 模型时设置 `HF_ENDPOINT=https://hf-mirror.com`（用户在中国网络环境）。
- 不要访问 developers.openai.com 等外网文档，本地代码已够用。

## 六、验收清单

1. `火旺剧本/` 23 集 docx 全部上传解析，场标预览应为 607 场，无 `日/内` 残成旁白。
2. edge-tts 路线：试听、角色分配、围读、存档、整集拼接。
3. Qwen 路线：声音设计生成种子、参考音频克隆、角色合成、重生成、整集拼接。
4. 存档目录选择、文件"在资源管理器中显示"。
5. 首次运行安装脚本能断点续传下载模型，日志可读。

## 七、协作约定

- 中文沟通；先读文档再动手；复杂逻辑先讨论，用户说"执行"后再改。
- 每完成一步 `git commit`；`xhs/` 永远不 `git add`。
- 不做破坏性操作（`git reset --hard`、`git checkout --`、`rm -rf` 等）。
- 测试以真实浏览器、真实渲染和真实 4060 生成为准，不只信计算值。
