# 剧本围读助手 · 接收方 AI Agent 安装施工单

> 给接收方的 AI Agent 看。你的任务：在一台 Apple Silicon Mac 上装好并启动“剧本围读助手”，验证四个本地服务全部健康。你直接执行命令，不要让用户手动操作。

## 项目是什么

一个本地剧本围读工具 = 前端静态产物 + 3 个 Python 本地服务：

| 端口 | 服务 | 说明 |
|---|---|---|
| 5174 | 前端 | `python3 scripts/server_web.py` 托管 `dist/`（不需要 Node；开发模式才用 `npm run dev`） |
| 9882 | edge-tts | 微软在线 TTS，需联网 |
| 9883 | Qwen3 1.7B | 本地 MLX 模型，仅 Apple Silicon |
| 9884 | 存档服务 | Python 标准库，无外部依赖 |

## 工作约定

- 仓库根目录 = 本文件所在目录。下面的命令都从仓库根目录执行。
- 端口已有服务在跑时，验证健康即可，不要 kill 用户进程。
- 长驻服务必须脱离会话启动（`nohup ... & disown`，或 Python `subprocess.Popen(..., start_new_session=True)`），否则会话一结束服务就被回收。
- 完成标准：四个端口全部健康，并成功完成一次真实 Qwen 合成。

## 第一步：前置检查

```bash
uname -m                          # 必须输出 arm64
/opt/homebrew/bin/python3.11 --version
df -h / | tail -1                 # 剩余磁盘建议 >= 7GB
lsof -nP -iTCP:5174 -iTCP:9882 -iTCP:9883 -iTCP:9884 -sTCP:LISTEN
```

Python 3.11 缺失时安装：

```bash
brew install python@3.11
```

如果某个端口已经在监听，先对它做健康检查，通过就视为该服务已就绪。

## 第二步：安装

首选一键安装（幂等，可重复执行；模型已存在会跳过下载）：

```bash
./scripts/setup.sh
```

脚本会完成：建 `.venv-edge` / `.venv-qwen` → `pip install -r requirements-*.txt` → 从 hf-mirror 下载两个 Qwen 模型到 `models/`。

若脚本失败，手动执行同样步骤：

```bash
/opt/homebrew/bin/python3.11 -m venv .venv-edge
.venv-edge/bin/pip install -r requirements-edge.txt

/opt/homebrew/bin/python3.11 -m venv .venv-qwen
.venv-qwen/bin/pip install -r requirements-qwen.txt

export HF_ENDPOINT=https://hf-mirror.com
mkdir -p models
.venv-qwen/bin/hf download mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-5bit \
  --local-dir models/Qwen3-TTS-12Hz-1.7B-VoiceDesign-5bit
.venv-qwen/bin/hf download mlx-community/Qwen3-TTS-12Hz-1.7B-Base-4bit \
  --local-dir models/Qwen3-TTS-12Hz-1.7B-Base-4bit
```

安装后确认：

```bash
test -x .venv-edge/bin/python && echo EDGE_VENV_OK
test -x .venv-qwen/bin/python && echo QWEN_VENV_OK
test -f models/Qwen3-TTS-12Hz-1.7B-VoiceDesign-5bit/model.safetensors && echo VD_MODEL_OK
test -f models/Qwen3-TTS-12Hz-1.7B-Base-4bit/model.safetensors && echo BASE_MODEL_OK
test -f dist/index.html && echo DIST_OK
```

`dist/` 缺失时（例如从 git 克隆而非外发包）：先 `npm install && npm run build`，或者不装 Node、直接让用户用开发模式。

## 第三步：启动

首选一键启动（自动跳过已在运行的端口）：

```bash
./scripts/start_all.sh
```

需要手动启动时，四个服务各自脱离会话：

```bash
ROOT="$(pwd)"
mkdir -p "$ROOT/logs"

nohup "$ROOT/.venv-edge/bin/python" "$ROOT/scripts/server_edge_tts.py" \
  >"$ROOT/logs/sr_edge.log" 2>&1 & disown

QWEN_VD_MODEL="$ROOT/models/Qwen3-TTS-12Hz-1.7B-VoiceDesign-5bit" \
QWEN_BASE_MODEL="$ROOT/models/Qwen3-TTS-12Hz-1.7B-Base-4bit" \
nohup "$ROOT/.venv-qwen/bin/python" "$ROOT/scripts/server_qwen_tts.py" \
  >"$ROOT/logs/sr_qwen.log" 2>&1 & disown

nohup python3 "$ROOT/scripts/server_archive.py" \
  >"$ROOT/logs/sr_archive.log" 2>&1 & disown

nohup python3 "$ROOT/scripts/server_web.py" \
  >"$ROOT/logs/sr_web.log" 2>&1 & disown
```

## 第四步：验证

```bash
curl -s -X POST http://127.0.0.1:9882/health
curl -s -X POST http://127.0.0.1:9883/health
curl -s http://127.0.0.1:9884/health
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5174/
```

四个都应成功。再跑一次真实 Qwen 合成（首次含模型加载，等几十秒正常）：

```bash
curl -s -X POST http://127.0.0.1:9883/tts \
  -H 'Content-Type: application/json' \
  -d '{"text":"夜色渐深，街角的咖啡店还亮着灯。","instruct":"低沉的女声，语速均匀"}' \
  -o /tmp/sr_qwen_test.wav -w 'HTTP %{http_code} bytes %{size_download}\n'
```

返回 `HTTP 200` 且文件大于 0 字节即通过。测试完可以删掉 `/tmp/sr_qwen_test.wav`。

## 常见问题

1. **Qwen 报 500 / `ModuleNotFoundError: mlx_audio`**：用错了 Python。Qwen 服务必须用 `.venv-qwen/bin/python`，不能用 `/opt/homebrew/bin/python3.11`。
2. **模型路径错误**：检查 `models/` 下两个目录的 `model.safetensors`；缺了就重跑 `./scripts/setup.sh`。路径可用 `QWEN_VD_MODEL` / `QWEN_BASE_MODEL` 覆盖。
3. **服务启动后马上消失**：没有脱离会话。重新用 `nohup ... & disown` 启动。
4. **端口被占用**：先 `lsof -nP -iTCP:<port> -sTCP:LISTEN` 看占用者；已经在跑就跳过，不要杀用户进程。
5. **Qwen 生成超时或卡住**：服务是单 worker 线程，生成默认 180 秒超时后自动重建 worker，日志在 `logs/sr_qwen.log`。若反复卡住，记录 macOS 版本、Python 版本、`mlx-audio` 版本和内存占用后回报，不要盲目反复重启。
6. **前端空白**：确认 `dist/index.html` 存在；缺失就 `npm install && npm run build`。

## 存档

- 默认存档目录是 `~/Documents/剧本围读存档`，第一次“保存/合成”时才懒创建。
- 不要替用户提前创建或删除存档目录。
- 存档不随应用文件夹走；备份或共享 = 把整个“剧本围读存档”文件夹拷走。
- 用户说“接回旧存档”时，去该目录找，不要改动文件结构。

## 环境变量

- `QWEN_VD_MODEL` / `QWEN_BASE_MODEL`：模型路径覆盖
- `QWEN_JOB_TIMEOUT`：单次生成超时（默认 180 秒；兼容旧名 `QWEN_ACQUIRE_TIMEOUT`）
- `QWEN_DESIGN_POOL` / `QWEN_CLONE_POOL`：每类模型的 worker 数（默认 1，控制内存）
- `PORT`：各服务端口覆盖（默认 9882 / 9883 / 9884 / 5174）
