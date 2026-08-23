# Version history

Records for `packs/claude-code-web-users-support/pack.mjs`'s `version` field, one row per bump — added going forward from
the version this file was introduced beside (60821.1); earlier bumps are not backfilled.

| Version | Date | What changed |
|---|---|---|
| 60823.1 | 2026-08-23 | Reads the pack entry from either settings-file name while the #1252 rename drains; the environment setup script finds a repo root by either. |
| 60822.1 | 2026-08-22 | The manifest stops restating its own tree (#1246): `id`, `prose`, `badge`, `skills`, `worldRules` and `workRules` are resolved from the pack directory and an absent `detect`/`marker` means no fingerprint. Coded rules move into `worldRules/`/`workRules/` and tests into `test/`, which no vendor set ships. `minEngineVersion` rises to the engine release that reads all of it. |
