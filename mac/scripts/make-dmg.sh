#!/usr/bin/env bash
# Package LaughCounter.app into a drag-to-install .dmg. Runs on macOS.
set -euo pipefail
cd "$(dirname "$0")/.."   # -> mac/

APP="dist/LaughCounter.app"
DMG="dist/LaughCounter.dmg"
STAGE="dist/dmg-stage"

if [ ! -d "$APP" ]; then
    echo "error: $APP not found — run scripts/build-app.sh first" >&2
    exit 1
fi

rm -rf "$STAGE" "$DMG"
mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"   # drag-to-Applications shortcut

# Give the mounted volume the app's icon. Baking .VolumeIcon.icns into the source
# folder (and flagging the folder as having a custom icon) is carried through by
# hdiutil, so the install window shows the 😄 icon — no fragile Finder scripting.
ICNS="$APP/Contents/Resources/AppIcon.icns"
if [ -f "$ICNS" ]; then
    cp "$ICNS" "$STAGE/.VolumeIcon.icns"
    command -v SetFile >/dev/null && SetFile -a C "$STAGE" || true
fi

hdiutil create -volname "LaughCounter" \
    -srcfolder "$STAGE" -ov -format UDZO "$DMG"

rm -rf "$STAGE"
echo "Built $DMG"
