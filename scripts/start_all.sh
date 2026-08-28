#!/bin/bash
# 一键启动：前端(5174) + edge-tts(9882) + Qwen3(9883) + 存档服务(9884)
# 服务用 nohup 脱离当前会话启动，关掉终端后仍然存活。
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p "$ROOT/logs"

say() { printf '[剧本围读] %s\n' "$*"; }

service_health() {
  curl -s -m 2 -X POST "http://127.0.0.1:$1/health" >/dev/null 2>&1
}

web_health() {
  curl -s -m 2 -o /dev/null "http://127.0.0.1:$1/" >/dev/null 2>&1
}

start_service() {
  local name="$1" port="$2" log="$3"
  shift 3
  if service_health "$port"; then
    say "$name 已在运行（端口 ${port}），跳过"
    return 0
  fi
  say "启动 ${name}（端口 ${port}）..."
  "${ARCHIVE_PY:-python3}" "$ROOT/scripts/detach.py" "$log" "$@"
}

# 优先用文件夹内的 venv/模型，找不到再退回老机器的绝对路径
EDGE_PY="${EDGE_PY:-}"
if [ -z "$EDGE_PY" ] && [ -x "$ROOT/.venv-edge/bin/python" ]; then
  EDGE_PY="$ROOT/.venv-edge/bin/python"
fi
if [ -z "$EDGE_PY" ]; then
  EDGE_PY="/Users/hetan/Documents/剧本围读/edge-tts-tool/.venv/bin/python"
fi

QWEN_PY="${QWEN_PY:-}"
if [ -z "$QWEN_PY" ] && [ -x "$ROOT/.venv-qwen/bin/python" ]; then
  QWEN_PY="$ROOT/.venv-qwen/bin/python"
fi
if [ -z "$QWEN_PY" ]; then
  QWEN_PY="/Users/hetan/Documents/剧本围读/qwen3-tts-test/.venv/bin/python"
fi

QWEN_VD_MODEL="${QWEN_VD_MODEL:-}"
if [ -z "$QWEN_VD_MODEL" ] && [ -d "$ROOT/models/Qwen3-TTS-12Hz-1.7B-VoiceDesign-5bit" ]; then
  QWEN_VD_MODEL="$ROOT/models/Qwen3-TTS-12Hz-1.7B-VoiceDesign-5bit"
fi
if [ -z "$QWEN_VD_MODEL" ]; then
  QWEN_VD_MODEL="/Users/hetan/Documents/剧本围读/qwen3-tts-test/models/Qwen3-TTS-12Hz-1.7B-VoiceDesign-5bit"
fi

QWEN_BASE_MODEL="${QWEN_BASE_MODEL:-}"
if [ -z "$QWEN_BASE_MODEL" ] && [ -d "$ROOT/models/Qwen3-TTS-12Hz-1.7B-Base-4bit" ]; then
  QWEN_BASE_MODEL="$ROOT/models/Qwen3-TTS-12Hz-1.7B-Base-4bit"
fi
if [ -z "$QWEN_BASE_MODEL" ]; then
  QWEN_BASE_MODEL="/Users/hetan/Documents/剧本围读/qwen3-tts-test/models/Qwen3-TTS-12Hz-1.7B-Base-4bit"
fi

ARCHIVE_PY="${ARCHIVE_PY:-python3}"

if [ ! -x "$EDGE_PY" ]; then
  say "缺少 edge-tts venv（${EDGE_PY}），请先运行 setup.command"
  exit 1
fi

QWEN_READY=1
if [ ! -x "$QWEN_PY" ]; then
  say "缺少 Qwen3 venv，跳过 Qwen3 服务（edge-tts 仍可用）；想启用 Qwen 请先运行 setup.command"
  QWEN_READY=0
elif [ ! -d "$QWEN_VD_MODEL" ] || [ ! -d "$QWEN_BASE_MODEL" ]; then
  say "Qwen 模型未下载，跳过 Qwen3 服务；请先运行 setup.command 下载模型"
  QWEN_READY=0
fi

start_service "edge-tts" 9882 "$ROOT/logs/sr_edge.log" "$EDGE_PY" "$ROOT/scripts/server_edge_tts.py"
if [ "$QWEN_READY" = "1" ]; then
  start_service "Qwen3" 9883 "$ROOT/logs/sr_qwen.log" \
    env QWEN_VD_MODEL="$QWEN_VD_MODEL" QWEN_BASE_MODEL="$QWEN_BASE_MODEL" \
    "$QWEN_PY" "$ROOT/scripts/server_qwen_tts.py"
fi
start_service "存档服务" 9884 "$ROOT/logs/sr_archive.log" "$ARCHIVE_PY" "$ROOT/scripts/server_archive.py"

if web_health 5174; then
  say "前端已在运行（端口 5174），跳过"
elif [ -f "$ROOT/dist/index.html" ]; then
  say "启动前端静态服务（端口 5174）..."
  "$ARCHIVE_PY" "$ROOT/scripts/detach.py" "$ROOT/logs/sr_web.log" \
    "$ARCHIVE_PY" "$ROOT/scripts/server_web.py"
elif command -v npm >/dev/null 2>&1; then
  say "没有 dist/，退回开发模式：npm run dev"
  "$ARCHIVE_PY" "$ROOT/scripts/detach.py" "$ROOT/logs/sr_web.log" npm run dev
else
  say "没有 dist/，也没有 Node.js，无法启动前端"
  exit 1
fi

sleep 3
for port in 5174 9882 9884; do
  if service_health "$port" 2>/dev/null || web_health "$port" 2>/dev/null; then
    say "服务 $port: OK"
  else
    say "警告: $port 未启动，请看 $ROOT/logs/ 下的日志"
  fi
done
if [ "$QWEN_READY" = "1" ]; then
  if service_health 9883; then
    say "服务 9883: OK"
  else
    say "警告: 9883 未启动，请看 $ROOT/logs/sr_qwen.log"
  fi
fi

if command -v open >/dev/null 2>&1; then
  ( sleep 1; open "http://127.0.0.1:5174/" 2>/dev/null ) &
fi
