# CI & release — the macOS DMG

How `LaughCounter.dmg` reaches users, and the workflow-trigger gotchas learned
wiring it up. Read before editing `.github/workflows/release-macos-dmg.yml` or
`build-macos-dmg.yml`.

**The shape.** `release-macos-dmg.yml` owns `main`: on a push to `main` touching
`mac/**` it builds the DMG, derives `v<version>` from `mac/Resources/Info.plist`,
and creates/updates that GitHub Release with `LaughCounter.dmg` attached — so the
README's stable `releases/latest/download/LaughCounter.dmg` link always resolves.
`build-macos-dmg.yml` is the feature-branch artifact builder and **excludes
`main`** (`branches: ["**", "!main"]`) so it never duplicates the release build.

## Trigger the release on push-to-main, not a `v*` tag push

A Claude Code **web session pushes through a git-only proxy that cannot push
`v*` tags**, so a release workflow keyed on `push: tags` never fires from a
session — the Release area stays empty and the `latest/download` link 404s. Key
the release on **push to `main`** (scoped to `mac/**`) instead: the job derives
`v<version>` from `Info.plist` and creates the tag + Release with `GITHUB_TOKEN`,
which *can* tag and release from within Actions even though the session can't.
(#18 / #19)

## A UI-published Release does not fire `push: tags` — add `release: published`

Publishing a Release from the GitHub UI creates the tag but does **not** emit a
`push: tags` event, so a workflow listening only for tag pushes won't build for
it. Keep a `release: types: [published]` trigger alongside the push-to-main one so
a hand-published Release still builds and attaches the DMG. (#11 / #13)

## Why the two triggers don't loop or double-build

- The tag + Release the push-to-main job creates is made with `GITHUB_TOKEN`, and
  a Release created by `GITHUB_TOKEN` does **not** re-fire the `release` event —
  so the `release: published` trigger doesn't re-run it. (This is the canon's
  general "`GITHUB_TOKEN` doesn't start another workflow" rule, applied to the
  `release` event specifically.)
- `build-macos-dmg.yml` excludes `main`, so a `mac/**` push to `main` builds once
  (in the release job), not twice.

## Signing & notarization is an optional, secret-gated lane (#4)

Both DMG workflows have an **optional** Developer ID signing + Apple notarization
lane that runs only when the signing secrets are set (`MACOS_CERT_P12`,
`MACOS_CERT_PASSWORD`, `MACOS_SIGN_IDENTITY`, `APPLE_ID`, `APPLE_TEAM_ID`,
`APPLE_APP_PASSWORD`); without them the build still passes and ships an **ad-hoc**
DMG. **Keep it secret-gated** — never make signing a required step, or a fork or
secret-less build breaks. The signing/notarization how-to and the user-facing
Gatekeeper steps live in `mac/README.md`; `scripts/build-app.sh` signs and
`scripts/notarize-dmg.sh` notarizes + staples. The CI-side gotchas that aren't in
the README:

- **Notarization requires the Hardened Runtime** (`codesign --options runtime`),
  and under it the mic needs an explicit entitlement
  (`com.apple.security.device.audio-input`, in
  `mac/Resources/LaughCounter.entitlements`) that an ad-hoc build doesn't — so
  turning on notarization silently kills mic access unless the entitlement ships
  with it. (Speech recognition is gated by TCC + the Info.plist usage string, not
  a codesign entitlement, so it needs nothing there.)
- **An ad-hoc signature can't be notarized** — they're separate lanes; only the
  Developer-ID-signed `.app` (built when `MACOS_SIGN_IDENTITY` is set) can be
  submitted to the notary service.
- **The ephemeral signing keychain must be added to the searchable keychain
  list** (`security list-keychains -d user -s "$KEYCHAIN" $(security
  list-keychains -d user | sed …)`) or `codesign` can't find the imported
  identity. That `sed` pipe is why the workflows set `defaults.run.shell: bash`
  for pipefail (#27; enforced by the canon `gha/run-pipefail` check).
- **macOS 15 (Sequoia) removed the right-click → Open Gatekeeper bypass** — the
  ad-hoc install path is now System Settings → Privacy & Security → *Open Anyway*,
  or `xattr -dr com.apple.quarantine <app>` (see `mac/README.md`).
- This is the **non–App Store** track (no App Sandbox); a Mac App Store build
  would need the App Sandbox and a different Apple Distribution certificate.
