# tidy-issues

## Why the declaration reads as it does

Carried over from the declaration's comments when it became `task.json`.

tidy-repo task: tidy-issues — the ACTING half of the tidy sweep
(per-project-scheduling DESIGN §6). Triages the issues the window touched, and
re-checks every open issue when the default branch moved substantively (a real
commit can implement an old issue without the issue itself being touched).
Worker: task.md. PRs are a separate task: one dimension per task, each with its
own trigger, scope, and tracker — no ordering barrier between them.

An issue of this repo's own moved. The scheduler's own work items are not such
an issue — the term filters them out, so the queue's churn never wakes this.
