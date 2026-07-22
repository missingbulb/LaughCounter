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
