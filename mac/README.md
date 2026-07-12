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

**⬇️ [Download the latest LaughCounter.dmg](https://github.com/missingbulb/LaughCounter/releases/latest/download/LaughCounter.dmg)** — this link always points at the most recent published release.

Prefer a specific build, or no release published yet? The app is also built for
every change by GitHub Actions on a macOS runner:

1. Go to the repo's **Actions** tab → open the latest **“Build macOS DMG”** run.
2. Download the **`LaughCounter-dmg`** artifact and unzip it to get `LaughCounter.dmg`.

*(Releases are published by pushing a `v*` tag — see “Cutting a release” below.)*

## Install

1. Open `LaughCounter.dmg` and drag **LaughCounter** into **Applications**.
2. First launch only: **right-click the app → Open → Open** (it's ad-hoc signed, so
   this one-time step gets past Gatekeeper — no paid Apple account needed).
3. Approve **Microphone** and **Speech Recognition** when prompted.
4. A 😄 with a number appears in your menu bar. That's it.

**Always-on:** add it to **System Settings → General → Login Items** so it starts
with the Mac. **Uninstall:** quit it, drag the app to the Trash, and (optionally)
delete `~/Library/Application Support/LaughCounter/`.

## Build it yourself (optional, on a Mac)

```bash
cd mac
python3 scripts/gen-icon.py   # -> Resources/AppIcon.png (only if you edit the icon)
bash scripts/build-app.sh     # -> dist/LaughCounter.app  (bakes AppIcon.icns)
bash scripts/make-dmg.sh      # -> dist/LaughCounter.dmg  (with the 😄 volume icon)
```

Requires the Swift toolchain (Xcode Command Line Tools). No third-party packages.
The app icon is generated from code by `scripts/gen-icon.py` (pure Python stdlib);
the committed `Resources/AppIcon.png` master is turned into a multi-resolution
`.icns` at build time with `sips`/`iconutil`.

## Cutting a release

Releases are published automatically from a version tag:

```bash
git tag v0.2.0
git push origin v0.2.0
```

The **Release macOS DMG** workflow builds the app, packages the DMG, and publishes
a GitHub Release with `LaughCounter.dmg` attached — which is what the
[latest-release download link](https://github.com/missingbulb/LaughCounter/releases/latest/download/LaughCounter.dmg)
at the top resolves to.

## The laugh log

Laughs are appended to `~/Library/Application Support/LaughCounter/laughs.jsonl`,
one JSON object per line, fields in a fixed order:

| field | meaning |
|-------|---------|
| `start_iso` | human-readable start time (ISO-8601) |
| `label` | `auto` (detected), `missed` (you told us we missed one), `candidate` (sub-threshold — logged for tuning, **not counted**), `rejected` (not counted) |
| `start` / `end` | epoch seconds of the laugh's real start/end (from the classifier's window timing) |
| `peak` | highest laughter confidence during the laugh (0–1, rounded) |
| `duration` | `end − start` in seconds |
| `mean` | average laughter confidence across the laugh |
| `source` | `mic` (auto), `voice` (spoken “I just laughed”), `button` (menu / ⌘L) |
| `type` | which laugh class fired (e.g. giggle, chuckle), when known |
| `context` | top competing non-laugh classes heard — used to spot TV audio |

**Sub-threshold logging:** anything that clears a lower bar but not the counting
threshold is written with `label:"candidate"` so you can analyse near-misses and
tune thresholds later — candidates never affect the menu-bar count.

**TV de-confliction:** a would-be laugh whose TV-context classes (applause, crowd,
music…) out-score the laughter is *suppressed* — not counted — and the reason is
written to the **activity log** (`laughcounter.log`, next to the laugh log; open it
from the menu). That log also records lifecycle events (started / slept / woke /
reconfigured / errors), so if listening ever stops you can see why.

## Notes & limits

See [`../docs/DESIGN-AND-TRADEOFFS.md`](../docs/DESIGN-AND-TRADEOFFS.md) for the
full picture: how misses become improvements (threshold tuning now, a personalised
Create ML model later), the who-laughed plan, and the voice-command tradeoffs
(false triggers, on-device availability).
