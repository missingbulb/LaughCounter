# Version history

Records for `packs/claudinite-growth/pack.mjs`'s `version` field, one row per bump. The rows
below are version-numbered comments that used to sit beside `version:` in the manifest, moved
here verbatim; nothing earlier than the first of them was backfilled. Every bump from here
forward adds its own row.

| Version | Date | What changed |
|---|---|---|
| 60824.1 | 2026-08-24 | `usage-fold` and the two task-declaration checks move to the new `claudinite-tasks` pack, which owns the mechanism they are about (#1317). |
| 60823.3 | 2026-08-23 | `writing-tasks` states the secrets path as it now works: the executor holds every repo secret and hands each task's code-work exactly the names its own declaration lists, rather than a converge stamping names into the workflows (#1301). |
| 60823.2 | 2026-08-23 | Prose and task docs name the member settings file by its current name, `.claudinite-settings.json` (#1252). |
| 60823.1 | 2026-08-23 | The growth tasks drop their standing tracker issues: every change automatic work makes to a local pack is a row in that pack's own `VERSIONS.md`, written in the same commit. `rule-revalidation` stops slicing by longest-since-probed and takes every environment-fact claim each run, so it holds no state between runs. `growth-dedup`'s window brief moves onto the run's own work item as a comment. |
| 60822.1 | — | `usage-fold` folds daily rather than hourly, and its signal window moves with it — a frequency finer than the cron's two ticks a day cannot be honoured, and a window still sized to an hour would never see a captured session again (§17.1). `growth-extract`'s anchor offset retires; the `schedule_after:` it already declared is what orders it. The ordering field is renamed `after` → `schedule_after`: it names task ids, not a time, and what it steers is when the item is scheduled onto an executor. `after` is normalized at the door forever and draws an advisory rename, so a member's own task file keeps working. |
| 13 | — | The task contract's prose carries the queue's current label vocabulary and the precondition's two additions — the occurrence argument, and the verdict a precondition gives when it cannot answer. |
| 60820.2 | — | Writing-tasks stops teaching the roll — a decline is a schedule-board row at the anchor, and a pick-time no-go closes its item (#1115). |
| 60821.1 | — | Usage-fold becomes the dashboard's past-data plane — hourly on a movement precondition, an hour tier, the queue's own closed-item outcomes in place of the retired slot-scheduler census, and the git/rule-token/token series (#1158). The file's readers accept every earlier version, so nothing in a member has to be rewritten and there is no migration record. |
| 60821.2 | 2026-08-21 | This pack's inline version-history comments moved out of `pack.mjs` into this file. |
| 60822.2 | 2026-08-23 | The manifest stops restating its own tree (#1246): `id`, `prose`, `badge`, `skills`, `worldRules` and `workRules` are resolved from the pack directory and an absent `detect`/`marker` means no fingerprint. Coded rules move into `worldRules/`/`workRules/` and tests into `test/`, which no vendor set ships. `minEngineVersion` rises to the engine release that reads all of it. |
