# LaughCounter for macOS (native menu-bar app)

The clean way to run LaughCounter on a Mac: a tiny menu-bar app that uses only
**built-in macOS frameworks** — nothing to install, nothing left behind.

- **Detects laughter** with Apple's built-in Sound Analysis (no model download).
- **Counts** distinct laughs and **logs** them to
  `~/Library/Application Support/LaughCounter/laughs.jsonl` (no audio saved).
- **😄 menu-bar icon** shows today's count — that's your "it's running" light.
- **A soft blip** plays when a laugh is logged.
- **Say “I just laughed”** and it logs a laugh it missed, blipping **twice** to
  confirm (on-device speech recognition — nothing leaves your Mac). There's also a
  menu item / ⌘L if you'd rather click.

## Get it (no Xcode needed)

The app is built for you by GitHub Actions on a macOS runner:

1. Go to the repo's **Actions** tab → open the latest **“Build macOS DMG”** run.
2. Download the **`LaughCounter-dmg`** artifact and unzip it to get `LaughCounter.dmg`.
   *(Or, for tagged releases, grab `LaughCounter.dmg` from the **Releases** page.)*

## Install

1. Open `LaughCounter.dmg` and drag **LaughCounter** into **Applications**.
2. **Get past Gatekeeper (first launch only).** The app is ad-hoc signed but not
   notarized (that needs a paid Apple Developer account), so macOS blocks the first
   open with *“Apple could not verify LaughCounter is free of malware.”* Clear it
   **one of two ways**:
   - **System Settings:** click **Done** on the warning, then open **System
     Settings → Privacy & Security**, scroll to **Security**, and click **Open
     Anyway** next to *“LaughCounter was blocked…”*. Confirm **Open Anyway** again.
   - **Terminal (most reliable):** after dragging it to Applications, run
     `xattr -dr com.apple.quarantine /Applications/LaughCounter.app`, then open it
     normally.

   > On **macOS 15 (Sequoia)** the old **right-click → Open** shortcut no longer
   > bypasses this — you must use one of the two methods above.
3. Approve **Microphone** and **Speech Recognition** when prompted.
4. A 😄 with a number appears in your menu bar. That's it.

**Always-on:** add it to **System Settings → General → Login Items** so it starts
with the Mac. **Uninstall:** quit it, drag the app to the Trash, and (optionally)
delete `~/Library/Application Support/LaughCounter/`.

## Build it yourself (optional, on a Mac)

```bash
cd mac
bash scripts/build-app.sh     # -> dist/LaughCounter.app
bash scripts/make-dmg.sh      # -> dist/LaughCounter.dmg
```

Requires the Swift toolchain (Xcode Command Line Tools). No third-party packages.

This produces an **ad-hoc-signed** app (the Gatekeeper step under *Install*
applies). To instead sign it with a real **Developer ID** and notarize it — so
it opens with no warning — you need a paid Apple Developer account, then:

```bash
export MACOS_SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)"
bash scripts/build-app.sh          # signs with Hardened Runtime + entitlements
bash scripts/make-dmg.sh
export APPLE_ID=you@example.com APPLE_TEAM_ID=XXXXXXXXXX APPLE_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
bash scripts/notarize-dmg.sh       # submits to Apple + staples the ticket
```

CI does this automatically when the matching repository secrets are set — see
[`.github/workflows/build-macos-dmg.yml`](../.github/workflows/build-macos-dmg.yml).
This is the **non–App Store** path; a Mac App Store build additionally requires
the App Sandbox and a different (Apple Distribution) certificate.

## Notes & limits

See [`../docs/DESIGN-AND-TRADEOFFS.md`](../docs/DESIGN-AND-TRADEOFFS.md) for the
full picture: how misses become improvements (threshold tuning now, a personalised
Create ML model later), the who-laughed plan, and the voice-command tradeoffs
(false triggers, on-device availability).
