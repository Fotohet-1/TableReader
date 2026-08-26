# 给 AI Agent 的安装施工单

目标：在一台 Apple Silicon Mac 上装好“剧本围读助手”的地基并启动。你（agent）直接执行下面的命令，不需要让用户手动操作。

## 前置检查

- `uname -m` 应输出 `arm64`
- Python 3.11：`/opt/homebrew/bin/python3.11 --version`
- 磁盘剩余大于 6GB：`df -h / | tail -1`
- 网络能访问 `https://hf-mirror.com`

如果 Python 3.11 缺失，先安装：`brew install python@3.11`

## 步骤

1. 克隆并安装前端：

```bash
git clone <仓库地址> screenplay-reader
cd screenplay-reader
npm install
```

2. 建两个 Python venv 并安装依赖：

```bash
/opt/homebrew/bin/python3.11 -m venv .venv-edge
.venv-edge/bin/pip install edge-tts soundfile

/opt/homebrew/bin/python3.11 -m venv .venv-qwen
.venv-qwen/bin/pip install -U mlx-audio huggingface_hub
```

3. 下载 Qwen3 模型（约 4GB，走 hf-mirror）：

```bash
export HF_ENDPOINT=https://hf-mirror.com
mkdir -p models
.venv-qwen/bin/hf download mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-5bit --local-dir models/Qwen3-TTS-12Hz-1.7B-VoiceDesign-5bit
.venv-qwen/bin/hf download mlx-community/Qwen3-TTS-12Hz-1.7B-Base-4bit --local-dir models/Qwen3-TTS-12Hz-1.7B-Base-4bit
```

4. 启动全部服务（edge-tts 9882、Qwen3 9883、前端 5174）：

```bash
EDGE_PY="$PWD/.venv-edge/bin/python" \
QWEN_PY="$PWD/.venv-qwen/bin/python" \
QWEN_VD_MODEL="$PWD/models/Qwen3-TTS-12Hz-1.7B-VoiceDesign-5bit" \
QWEN_BASE_MODEL="$PWD/models/Qwen3-TTS-12Hz-1.7B-Base-4bit" \
./scripts/start_all.sh
```

5. 验证：

```bash
curl -s -X POST http://127.0.0.1:9882/health
curl -s -X POST http://127.0.0.1:9883/health
```

都返回 `{"ok": true}` 后，打开 http://127.0.0.1:5174/ 。

## 排查

- 端口被占用：先 `lsof -nP -iTCP -sTCP:LISTEN | grep -E '9882|9883|5174'` 看是不是已有服务，有就不用重复启动。
- 模型路径错误：确认 `models/` 下两个目录存在且包含 `model.safetensors`。
- 内存不足（16GB 以下）：只保留 VoiceDesign 模型，Base 可以先用 0.6B 替代，或全程用 edge-tts。
- 前端空白：检查 dev server 日志，`npm run dev` 必须在仓库根目录执行。
