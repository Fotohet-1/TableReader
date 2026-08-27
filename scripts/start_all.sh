#!/bin/bash
# 一键启动：edge-tts(9882) + Qwen3(9883) + 前端 dev server(5174)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EDGE_PY="${EDGE_PY:-/Users/hetan/Documents/剧本围读/edge-tts-tool/.venv/bin/python}"
QWEN_PY="${QWEN_PY:-/Users/hetan/Documents/剧本围读/qwen3-tts-test/.venv/bin/python}"

if [ ! -x "$EDGE_PY" ]; then
  echo "缺少 edge-tts venv: $EDGE_PY"
  exit 1
fi
if [ ! -x "$QWEN_PY" ]; then
  echo "缺少 Qwen3 venv: $QWEN_PY"
  exit 1
fi

echo "启动 edge-tts (9882) ..."
"$EDGE_PY" "$ROOT/scripts/server_edge_tts.py" >/tmp/sr_edge.log 2>&1 &
echo "启动 Qwen3 (9883) ..."
"$QWEN_PY" "$ROOT/scripts/server_qwen_tts.py" >/tmp/sr_qwen.log 2>&1 &
sleep 2
cd "$ROOT"
# 等服务就绪后自动打开浏览器
( sleep 3; open "http://127.0.0.1:5174/" 2>/dev/null ) &
npm run dev
