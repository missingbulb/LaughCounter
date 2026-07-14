#!/usr/bin/env bash
# Notarize the built .dmg with Apple and staple the ticket, so downloading it
# opens with no Gatekeeper "could not verify … malware" warning. Runs on macOS.
#
# Requires a paid Apple Developer account and these environment variables
# (CI sets them from repository secrets):
#   APPLE_ID           - the Apple ID email of the developer account
#   APPLE_TEAM_ID      - the 10-char Team ID (e.g. from developer.apple.com)
#   APPLE_APP_PASSWORD - an app-specific password for that Apple ID
#
# The .app inside must already be signed with a "Developer ID Application"
# identity under the Hardened Runtime (scripts/build-app.sh does this when
# MACOS_SIGN_IDENTITY is set).
set -euo pipefail
cd "$(dirname "$0")/.."   # -> mac/

DMG="dist/LaughCounter.dmg"

: "${APPLE_ID:?set APPLE_ID}"
: "${APPLE_TEAM_ID:?set APPLE_TEAM_ID}"
: "${APPLE_APP_PASSWORD:?set APPLE_APP_PASSWORD}"

if [ ! -f "$DMG" ]; then
    echo "error: $DMG not found — run scripts/make-dmg.sh first" >&2
    exit 1
fi

echo "Submitting $DMG to the Apple notary service (this can take a few minutes)…"
xcrun notarytool submit "$DMG" \
    --apple-id "$APPLE_ID" \
    --team-id "$APPLE_TEAM_ID" \
    --password "$APPLE_APP_PASSWORD" \
    --wait

echo "Stapling the notarization ticket to $DMG…"
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"

echo "Notarized and stapled $DMG"
