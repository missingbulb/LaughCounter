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

# Code signature.
#
# If MACOS_SIGN_IDENTITY is set (e.g. "Developer ID Application: Name (TEAMID)"),
# sign for real with the Hardened Runtime + entitlements so the .dmg can be
# notarized by Apple and opens with no Gatekeeper warning. CI sets this from a
# secret; see .github/workflows/build-macos-dmg.yml and scripts/notarize-dmg.sh.
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
