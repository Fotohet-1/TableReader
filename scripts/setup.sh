#!/bin/bash
# 剧本围读助手 · 一键安装
# 检查 Apple Silicon 和 Python 3.11，安装两个 venv，并从 hf-mirror 下载 Qwen3 模型。
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PY311="${PY311:-/opt/homebrew/bin/python3.11}"
ARCH="$(uname -m)"

echo "=== 剧本围读助手 · 一键安装 ==="

if [ "$ARCH" != "arm64" ]; then
  echo "本工具只支持 Apple Silicon Mac（M1/M2/M3/M4），当前架构是 $ARCH。"
  exit 1
fi

if [ ! -x "$PY311" ]; then
  echo "没找到 Python 3.11（${PY311}）。请先安装："
  echo "  brew install python@3.11"
  echo "装好后重新双击安装脚本。"
  exit 1
fi

FREE_GB="$(df -k / | awk 'NR==2 {printf "%d", $4/1024/1024}')"
if [ "$FREE_GB" -lt 7 ]; then
  echo "磁盘剩余空间不足（${FREE_GB}GB），安装至少需要 7GB。"
  exit 1
fi

echo "1/4 安装 edge-tts 依赖 ..."
if [ ! -x "$ROOT/.venv-edge/bin/python" ]; then
  "$PY311" -m venv "$ROOT/.venv-edge"
fi
"$ROOT/.venv-edge/bin/pip" install -q -r "$ROOT/requirements-edge.txt"

echo "2/4 安装 Qwen3 依赖 ..."
if [ ! -x "$ROOT/.venv-qwen/bin/python" ]; then
  "$PY311" -m venv "$ROOT/.venv-qwen"
fi
"$ROOT/.venv-qwen/bin/pip" install -q -r "$ROOT/requirements-qwen.txt"

echo "3/4 下载 Qwen3 模型（约 4.5GB，走 hf-mirror，可断点续传）..."
if [ -f "$ROOT/models/Qwen3-TTS-12Hz-1.7B-VoiceDesign-5bit/model.safetensors" ] &&
   [ -f "$ROOT/models/Qwen3-TTS-12Hz-1.7B-Base-4bit/model.safetensors" ]; then
  echo "模型已存在，跳过下载。"
else
  export HF_ENDPOINT=https://hf-mirror.com
  mkdir -p "$ROOT/models"
  "$ROOT/.venv-qwen/bin/hf" download mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-5bit \
    --local-dir "$ROOT/models/Qwen3-TTS-12Hz-1.7B-VoiceDesign-5bit"
  "$ROOT/.venv-qwen/bin/hf" download mlx-community/Qwen3-TTS-12Hz-1.7B-Base-4bit \
    --local-dir "$ROOT/models/Qwen3-TTS-12Hz-1.7B-Base-4bit"
fi

echo "4/4 检查前端构建产物 ..."
if [ ! -f "$ROOT/dist/index.html" ]; then
  echo "没有 dist/。需要先有 Node.js 并执行：npm install && npm run build"
  exit 1
fi

echo
echo "安装完成。以后双击 start.command 即可启动剧本围读助手。"
