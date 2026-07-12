#!/usr/bin/env bash
# Build LaughCounter.app from the Swift package. Runs on macOS (locally or in CI).
set -euo pipefail
cd "$(dirname "$0")/.."   # -> mac/

echo "Building release binary…"
swift build -c release

APP="dist/LaughCounter.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

BIN="$(swift build -c release --show-bin-path)/LaughCounter"
cp "$BIN" "$APP/Contents/MacOS/LaughCounter"
cp "Resources/Info.plist" "$APP/Contents/Info.plist"

# Ad-hoc code signature. Enough for personal use — on first launch you'll
# right-click the app and choose Open once to get past Gatekeeper.
codesign --force --deep --sign - "$APP" || echo "warning: ad-hoc codesign failed (continuing)"

echo "Built $APP"
