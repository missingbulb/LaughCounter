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

# Ad-hoc code signature (not notarized — that needs a paid Apple Developer
# account). Enough for personal use; to get past Gatekeeper on first launch,
# use System Settings → Privacy & Security → "Open Anyway", or run
#   xattr -dr com.apple.quarantine /Applications/LaughCounter.app
# See mac/README.md "Install" for the details.
codesign --force --deep --sign - "$APP" || echo "warning: ad-hoc codesign failed (continuing)"

echo "Built $APP"
