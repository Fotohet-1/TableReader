#!/bin/bash
# 打包正式外发包：默认 TableReader-正式版-v1.2.4.zip（可传版本号覆盖）
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
VERSION="${1:-1.2.4}"
OUT_DIR="/Users/hetan/Documents/剧本围读外发"
OUT="$OUT_DIR/TableReader-正式版-v$VERSION.zip"
mkdir -p "$OUT_DIR"

# 确保启动器 .app 是最新的
if [ ! -d "TableReader.app" ]; then
  bash scripts/make_app.sh
fi

rm -f "$OUT"
python3 scripts/package_release.py "$ROOT" "$OUT"

echo "已生成 $OUT"
