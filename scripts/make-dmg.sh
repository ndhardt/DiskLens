#!/usr/bin/env bash
# Package the built DiskLens.app into a distributable disk image.
#
# Tauri's own dmg target drives Finder over AppleScript to style the window,
# which fails on any machine that has not granted the shell Automation access
# to Finder. This does the same job with hdiutil alone: no styling, no Finder,
# always works.
set -euo pipefail

cd "$(dirname "$0")/.."
APP="src-tauri/target/release/bundle/macos/DiskLens.app"
VERSION=$(node -p "require('./package.json').version")
ARCH=$(uname -m)
OUT="src-tauri/target/release/bundle/dmg/DiskLens_${VERSION}_${ARCH}.dmg"

if [ ! -d "$APP" ]; then
  echo "DiskLens.app not found. Run 'npm run tauri build' first." >&2
  exit 1
fi

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"
hdiutil create \
  -volname "DiskLens" \
  -srcfolder "$STAGE" \
  -ov -format UDZO \
  "$OUT" >/dev/null

echo "$OUT"
ls -lh "$OUT" | awk '{print $5}'
