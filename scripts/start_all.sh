#!/bin/bash
# 一键启动：edge-tts(9882) + Qwen3(9883) + 存档服务(9884) + 前端 dev server(5174)
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
echo "启动存档服务 (9884) ..."
python3 "$ROOT/scripts/server_archive.py" >/tmp/sr_archive.log 2>&1 &
sleep 3
for port in 9882 9883 9884; do
  if curl -s -X POST "http://127.0.0.1:$port/health" >/dev/null 2>&1; then
    echo "服务 $port: OK"
  else
    echo "警告: $port 未启动，请查看 /tmp/sr_edge.log 或 /tmp/sr_qwen.log"
  fi
done
cd "$ROOT"
# 等前端就绪后自动打开浏览器
( sleep 3; open "http://127.0.0.1:5174/" 2>/dev/null ) &
npm run dev
