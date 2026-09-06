# Version history

Records for `packs/macos/pack.mjs`'s `version` field, one row per version, newest first.
A version is cut on `main` after its changes land, so a row names the pull requests that
landed between the previous version and this one; the weekly history task writes the rows
a version is missing and leaves every row that already stands.

| Version | Date | What changed |
|---|---|---|
| 60904.1 | 2026-09-04 | The `swift-toolchain-gate` check, promoted from LaughCounter's `local/macos-audio`: a `command -v swift` probe must sit behind an `xcode-select -p` gate, since `/usr/bin/swift` is a stub present on every Mac. |
| 60903.1 | 2026-09-03 | The `Info.plist`/`Package.swift` keys and the TCC/entitlement rules move out of `RULES.md` into the `macos-app-bundle` and `macos-entitlements-and-tcc` skills, forced by `force-load-on-file-edits-paths` for the files they govern; the notarized-build line moves to the README (#1662). |
| 60902.1 | 2026-09-02 | The TCC usage-description rule becomes a bullet keyed to reaching for a protected resource; section preambles and the descriptive framing go, the latter to the pack README. |
| 60822.1 | 2026-08-22 | The manifest stops restating its own tree (#1246): `id`, `prose`, `badge`, `skills`, `worldRules` and `workRules` are resolved from the pack directory and an absent `detect`/`marker` means no fingerprint. Coded rules move into `worldRules/`/`workRules/` and tests into `test/`, which no vendor set ships. `minEngineVersion` rises to the engine release that reads all of it. |
| 60820.1 | 2026-08-20 | Engine and pack versions become date-anchored `<day>.<n>` (#1105) |
| 3 | 2026-08-20 | Pack reorganization: two collapses and two renames (#1081) |
| 2 | 2026-08-18 | Three vocabulary enhancements — no new key families — and the five conversions they unlock (#891); Index every pack's rules and checks with words, severity and reason (#915); Prose to checks: the macOS deployment floor, and a cron off the :00 stampede (#901); Bump every pack whose content was edited without a version bump (#969) |
| 1 | 2026-08-12 | Canon pack macos: the pack, plus the portable half of LaughCounter's local packs (#756); Versioned updates Phase 0: version scaffolding (#769) |
