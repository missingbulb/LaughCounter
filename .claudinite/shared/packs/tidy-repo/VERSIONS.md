# Version history

Records for `packs/tidy-repo/pack.mjs`'s `version` field, one row per bump — added going forward from
the version this file was introduced beside (60820.1); earlier bumps are not backfilled.

| Version | Date | What changed |
|---|---|---|
| 60824.1 | 2026-08-24 | Prose names the scheduler at its new home in the `claudinite-tasks` pack (#1317). |
| 60823.1 | 2026-08-23 | Its seed record reads the declaration under either settings-file name while the #1252 rename drains. |
| 60822.1 | 2026-08-22 | The manifest stops restating its own tree (#1246): `id`, `prose`, `badge`, `skills`, `worldRules` and `workRules` are resolved from the pack directory and an absent `detect`/`marker` means no fingerprint. Coded rules move into `worldRules/`/`workRules/` and tests into `test/`, which no vendor set ships. `minEngineVersion` rises to the engine release that reads all of it. |
