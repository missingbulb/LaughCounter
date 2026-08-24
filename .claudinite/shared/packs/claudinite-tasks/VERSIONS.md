# Version history

Records for `packs/claudinite-tasks/pack.mjs`'s `version` field, one row per bump.

| Version | Date | What changed |
|---|---|---|
| 60824.5 | 2026-08-24 | The drain gate counts what the run itself readied alongside what the queue read returns, so an item created milliseconds earlier can no longer be missed and left unclaimed until the next cron fire (#1340). |
| 60824.4 | 2026-08-24 | The executor stub's secrets block describes what the converge stamps there and nothing else; the reason a serialised secrets context is not used lives in `converge-workflows.mjs`, where the decision is implemented (#1331). |
| 60824.3 | 2026-08-24 | The executor workflow names its secrets again, stamped by the converge at the `# claudinite:secrets` marker: `toJSON(secrets)` is the shape GitHub's malicious-workflow detection flags, and a flagged workflow parks every run behind a human approval (#1336, reversing #1301). |
| 60824.2 | 2026-08-24 | Scheduling wiring is the pack's own `converge-workflows.mjs`, scaffolded at adoption; a migration record declares the pack into every member that runs scheduled work (#1317). |
| 60824.1 | 2026-08-24 | The pack's first version: the task execution and scheduling surface moves out of `engine/scheduler/` into `packs/claudinite-tasks/`, with `task-janitor`, `usage-fold` and the two task-declaration checks relocating in beside it (#1317). |
