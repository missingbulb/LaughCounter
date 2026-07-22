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

# App icon: build a multi-resolution AppIcon.icns from the 1024² master PNG.
# The master is generated (reproducibly) by scripts/gen-icon.py and committed, so
# this step only needs macOS's sips + iconutil.
ICON_SRC="Resources/AppIcon.png"
if [ -f "$ICON_SRC" ] && command -v sips >/dev/null && command -v iconutil >/dev/null; then
    echo "Building app icon…"
    ICONSET="$(mktemp -d)/AppIcon.iconset"
    mkdir -p "$ICONSET"
    for pair in "16 16x16" "32 16x16@2x" "32 32x32" "64 32x32@2x" \
                "128 128x128" "256 128x128@2x" "256 256x256" "512 256x256@2x" \
                "512 512x512" "1024 512x512@2x"; do
        set -- $pair
        sips -z "$1" "$1" "$ICON_SRC" --out "$ICONSET/icon_$2.png" >/dev/null
    done
    iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
    rm -rf "$(dirname "$ICONSET")"
else
    echo "warning: AppIcon.png or sips/iconutil missing — app will use the default icon"
fi

# Code signature.
#
# If MACOS_SIGN_IDENTITY is set (e.g. "Developer ID Application: Name (TEAMID)"),
# sign for real with the Hardened Runtime + entitlements so the .dmg can be
# notarized by Apple and opens with no Gatekeeper warning. CI sets this from a
# secret; see the DMG workflows and scripts/notarize-dmg.sh.
#
# Otherwise fall back to an ad-hoc signature — fine for personal use, but macOS
# will block the first launch. Get past it with System Settings → Privacy &
# Security → "Open Anyway", or: xattr -dr com.apple.quarantine <app>.
# See mac/README.md "Install".
if [ -n "${MACOS_SIGN_IDENTITY:-}" ]; then
    echo "Signing with Developer ID (Hardened Runtime): $MACOS_SIGN_IDENTITY"
    codesign --force --options runtime \
        --entitlements "Resources/LaughCounter.entitlements" \
        --sign "$MACOS_SIGN_IDENTITY" "$APP"
    codesign --verify --strict --verbose=2 "$APP"
else
    echo "No MACOS_SIGN_IDENTITY set — using ad-hoc signature (not notarizable)."
    codesign --force --deep --sign - "$APP" || echo "warning: ad-hoc codesign failed (continuing)"
fi

echo "Built $APP"
