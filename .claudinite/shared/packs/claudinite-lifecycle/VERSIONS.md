# Version history

Records for `packs/claudinite-lifecycle/pack.mjs`'s `version` field, one row per bump. The
rows below are version-numbered comments that used to sit beside `version:` in the manifest,
moved here verbatim; nothing earlier than the first of them was backfilled, and a bump with no
comment (like 60821.2) was never recorded to begin with. Every bump from here forward adds its
own row.

| Version | Date | What changed |
|---|---|---|
| 60824.6 | 2026-08-24 | The update worker names the flows at their real home, and `scheduler-workflow-shape` requires the pack's scheduler entry now that every member's workflow names it (#1328). |
| 60824.5 | 2026-08-24 | `scheduler-workflow-shape` stops accepting the legacy hourly cron line, now that every member's workflow carries the two-tick form (#1234). |
| 60824.4 | 2026-08-24 | The update precondition stops guessing whether the member is behind: the canon's versions are unavailable to a scheduler run (DESIGN §3.3), and the local-movement proxy declined updates on members that were four packs stale (#1344). |
| 60824.3 | 2026-08-24 | The engine update lane ships `packs/claudinite-tasks/` alongside the engine while the legacy shims re-export it, so a member converging its engine before its packs does not get a mount that fails its own self-test (#1317). |
| 60824.2 | 2026-08-24 | The versioned update flows move in under `updates/`, canon-internal like a pack's `test/`; no flow touches `.github/workflows/` any more and the withhold staging lane is retired (#1317). |
| 60824.1 | 2026-08-24 | The update task lands through the `claudinite-tasks` pack's `shared-code/`, and `scheduler-workflow-shape` accepts the pack's entry path beside the legacy engine one (#1317). |
| 60823.1 | 2026-08-23 | The update runner resolves its settings file by name rather than naming it, takes delivery from `dailyClaudiniteUpdatesRequirePrReview`, and no longer asks which mechanism serves the repo; the update precondition takes newness from the mount's own movement in the window (#1252). |
| 60822.2 | — | `update`'s `daily-2h` offset retires — it is the head of the morning chain, and the tasks that read the mount it converges declare `schedule_after:` rather than an earlier clock hour (§17.1). Comment updated for the `after` → `schedule_after` rename. |
| 13 | — | Two task comments name the terminal a run closes with in its current spelling; no behaviour moves. |
| 60821.1 | — | Adopt-requested-packs runs ON the work-list issue the fleet marked — no code-work gate, no worker, and the item is the list itself (#1119). |
| 60821.3 | 2026-08-21 | This pack's inline version-history comments moved out of `pack.mjs` into this file. |
| 60822.1 | 2026-08-22 | The update worker's scratch-tree delete goes through the shared `removeTree`, whose retry survives git's own housekeeping still writing into the tree (#1219). |
| 60822.3 | 2026-08-23 | The manifest stops restating its own tree (#1246): `id`, `prose`, `badge`, `skills`, `worldRules` and `workRules` are resolved from the pack directory and an absent `detect`/`marker` means no fingerprint. Coded rules move into `worldRules/`/`workRules/` and tests into `test/`, which no vendor set ships. `minEngineVersion` rises to the engine release that reads all of it. |
