# Version history

Records for `packs/basics/pack.mjs`'s `version` field, one row per bump — added going forward from
the version this file was introduced beside (60821.4); earlier bumps are not backfilled.

| Version | Date | What changed |
|---|---|---|
| 60830.3 | 2026-08-30 | `/do-later` must settle the automerge value: the `Automerge:` field takes a policy expression, and a deferral that names none gets one `AskUserQuestion` proposing the narrowest fitting policy, review remaining the default only after the owner had the chance to choose. `ci-performance` declares `pr`/`anything` — CI itself gates a CI-performance fix (#1459). |
| 60827.2 | 2026-08-27 | `do-later` can defer onto a *moment*: a time-worded ask ("check tomorrow") rides the queue's `Not-before:` wait field instead of falling through to "queues immediately" (#1393). |
| 60824.1 | 2026-08-24 | The `task-janitor` task moves to the new `claudinite-tasks` pack, which owns the queue it sweeps (#1317). |
| 60823.1 | 2026-08-23 | Prose and skills name the member settings file by its current name, `.claudinite-settings.json` (#1252). |
| 60822.1 | 2026-08-22 | The manifest stops restating its own tree (#1246): `id`, `prose`, `badge`, `skills`, `worldRules` and `workRules` are resolved from the pack directory and an absent `detect`/`marker` means no fingerprint. Coded rules move into `worldRules/`/`workRules/` and tests into `test/`, which no vendor set ships. `minEngineVersion` rises to the engine release that reads all of it. |
| 60827.1 | 2026-08-27 | The task-janitor's queue sweep parks with ONE label — `task:status:needs-human-<kind>` — rather than the `needs-human` pair a half-applied swap could tear (#1119). |
| 60830.1 | 2026-08-30 | The `ci-performance` brief names the park the engine writes — one `task:status:needs-human-<kind>` (#1395). |
| 60830.2 | 2026-08-30 | The ad-hoc request skills place every field a run reads as one block on the issue body's first lines, and `verify-in-production`'s retry re-arms `Not-before:` to now + `Retry-every:` rather than to the stale value plus it (#1456). |
