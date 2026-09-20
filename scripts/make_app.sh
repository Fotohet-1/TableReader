#!/bin/bash
# 生成“TableReader”启动器 .app：双击后拉起四个本地服务并打开前端。
# 用法：bash scripts/make_app.sh   （产物：仓库根目录 TableReader.app）
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/TableReader.app"
RES="$APP/Contents/Resources"
MACOS="$APP/Contents/MacOS"
BASE512="$ROOT/public/icons/icon-512.png"
BASE1024="$ROOT/public/icons/icon-1024.png"

if [ ! -f "$BASE512" ]; then
  echo "缺少图标，先运行：python3 scripts/gen_app_icons.py"
  exit 1
fi

rm -rf "$APP"
mkdir -p "$RES" "$MACOS"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>TableReader</string>
  <key>CFBundleDisplayName</key><string>TableReader</string>
  <key>CFBundleIdentifier</key><string>com.fotohet1.tablereader</string>
  <key>CFBundleVersion</key><string>1.2.4</string>
  <key>CFBundleShortVersionString</key><string>1.2.4</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>TableReader</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

cat > "$MACOS/TableReader" <<SH
#!/bin/bash
DIR="\$(cd "\$(dirname "\$0")" && pwd)"
APP_ROOT="\$(cd "\$DIR/../../.." && pwd)"
exec bash "\$APP_ROOT/scripts/start.command"
SH
chmod +x "$MACOS/TableReader"

# 从图标生成 .icns（iconutil 要求源目录以 .iconset 结尾）
ICONSET="$ROOT/build/AppIcon.iconset"
rm -rf "$ROOT/build"
mkdir -p "$ICONSET"
cp "$BASE512" "$ICONSET/icon_256x256@2x.png"
cp "$BASE512" "$ICONSET/icon_512x512.png"
cp "$BASE1024" "$ICONSET/icon_512x512@2x.png"
sips -z 16 16 "$BASE512" --out "$ICONSET/icon_16x16.png" >/dev/null
sips -z 32 32 "$BASE512" --out "$ICONSET/icon_16x16@2x.png" >/dev/null
sips -z 32 32 "$BASE512" --out "$ICONSET/icon_32x32.png" >/dev/null
sips -z 64 64 "$BASE512" --out "$ICONSET/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "$BASE512" --out "$ICONSET/icon_128x128.png" >/dev/null
sips -z 256 256 "$BASE512" --out "$ICONSET/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "$BASE512" --out "$ICONSET/icon_256x256.png" >/dev/null
iconutil -c icns "$ICONSET" -o "$RES/AppIcon.icns"
rm -rf "$ROOT/build"

echo "已生成 $APP"
