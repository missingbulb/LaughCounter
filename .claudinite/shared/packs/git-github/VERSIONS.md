# Version history

Records for `packs/git-github/pack.mjs`'s `version` field, one row per bump. The rows below
are version-numbered comments that used to sit beside `version:` in the manifest, moved here
verbatim; nothing earlier than the first of them was backfilled. Every bump from here forward
adds its own row.

| Version | Date | What changed |
|---|---|---|
| 6 | — | The github-actions pack is absorbed here — its skill, its nine `gha/` checks, and the routing that used to name it as the neighbour. |
| 60820.2 | — | Merge-to-main step 7 is named as verify-in-production's only trigger (#1128). |
| 60821.1 | 2026-08-21 | This pack's inline version-history comments moved out of `pack.mjs` into this file. |
| 60822.1 | — | Contributes the repo's stars to the dashboard (#1194) — `dashboard.json`, a descriptor and no code, off the `repo-stars` source the page already reads. A member declaring this pack shows a star count on both dashboard pages; one that does not, no longer shows one anywhere, since the dashboard stopped drawing it itself. |
| 60822.2 | 2026-08-22 | The manifest stops restating its own tree (#1246): `id`, `prose`, `badge`, `skills`, `worldRules` and `workRules` are resolved from the pack directory and an absent `detect`/`marker` means no fingerprint. Coded rules move into `worldRules/`/`workRules/` and tests into `test/`, which no vendor set ships. `minEngineVersion` rises to the engine release that reads all of it. |
| 60901.1 | 2026-09-01 | Adds `references.md`: the four workflow checks #552 converted out of `git-github-advanced` now record the GitHub behaviour each encodes and what would retire it, and `merge-to-main` records why the capture step runs in-session (#1576). |
