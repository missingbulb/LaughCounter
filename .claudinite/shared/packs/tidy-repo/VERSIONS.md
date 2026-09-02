# Version history

Records for `packs/tidy-repo/pack.mjs`'s `version` field, one row per bump — added going forward from
the version this file was introduced beside (60820.1); earlier bumps are not backfilled.

| Version | Date | What changed |
|---|---|---|
| 60902.1 | 2026-09-02 | The three tidy tasks convert to declarative `preconditions`. `tidy-issues` becomes `['issues-touched']` and `tidy-prs` `['prs-touched']`, with what a granted run then works on — widening a triage to every open issue after a substantive `main` move, sweeping every open PR — moving into their worker docs, since scope is the worker's decision and the conditions decide only run or no-run. `improve-comments` becomes the three-condition conjunction its gate always was (#1578). |
| 60830.3 | 2026-08-30 | `improve-comments` declares its safety case as policy — `automerge: ['comment-only-changes', 'readme-changes']` — so the landing verdict is measured by the policy engine, with the skill's own scope gate still redding the same boundary on every branch wearing its title (#1459). |
| 60830.2 | 2026-08-30 | `improve-comments` ignores `.claudinite/`: the precondition drops the mount from a round's scope (and declines a window that changed nothing else), and the scope gate reds any change under it, comment-only or not (#1443). |
| 60830.1 | 2026-08-30 | `improve-comments` delivers its PR through the shared procedure (`merged-pr`) instead of parking it for a human: the repo's `maintenance.delivery` decides whether it lands, and the scope gate — not a reader — is the safety case (#1437). |
| 60827.2 | 2026-08-27 | A third dimension, `improve-comments`: the pack's first task whose subject is the repo's own source. Weekly over the files the window's commits touched, running the `improve-comments` skill and nothing else, declining while its previous PR is still open, and leaving its PR for review. The skill owns a blocking `improve-comments-scope` gate that strips the comments from both sides of every changed file and reds anything but comment text and `README.md` content. `RULES.md` is deleted: its bullets described what the pack's own workers do, and each worker already states its policy in the `task.md` it loads (#1383). |
| 60827.1 | 2026-08-27 | `tidy-issues` ignores any issue carrying a `task:*` label — the scheduler's own queue work items, which the signal's title filter misses when one is filed under another title (#1386). |
| 60824.2 | 2026-08-24 | `tidy-branches` is dropped; the pack keeps `tidy-issues` and `tidy-prs` (#1240). |
| 60824.1 | 2026-08-24 | Prose names the scheduler at its new home in the `claudinite-tasks` pack (#1317). |
| 60823.1 | 2026-08-23 | Its seed record reads the declaration under either settings-file name while the #1252 rename drains. |
| 60822.1 | 2026-08-22 | The manifest stops restating its own tree (#1246): `id`, `prose`, `badge`, `skills`, `worldRules` and `workRules` are resolved from the pack directory and an absent `detect`/`marker` means no fingerprint. Coded rules move into `worldRules/`/`workRules/` and tests into `test/`, which no vendor set ships. `minEngineVersion` rises to the engine release that reads all of it. |
