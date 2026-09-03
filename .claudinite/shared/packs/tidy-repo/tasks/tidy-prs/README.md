# tidy-prs

## Why the declaration reads as it does

Carried over from the declaration's comments when it became `task.json`.

tidy-repo task: tidy-prs — the read-only PR half of the tidy sweep
(per-project-scheduling DESIGN §6). One weekly full sweep over every open PR:
which should stay open, which are closeable. Recommends; never closes. Worker:
task.md. Issues are a separate task — one dimension per task, each with its own
trigger, scope, and tracker, so there is no ordering barrier.

WEEKLY, and full every time it runs — but it only runs when a PR actually moved
in the window. A PR verdict is a standing recommendation for a human, not a
same-day alert, so re-deriving the whole picture once a week beats a daily partial
one — and "weekly" is a frequency DECLARATION, never a gate trick inside a daily
task (DESIGN §3). What "full" does not mean is unconditional: an untouched set of
open PRs yields last week's verdicts again, so the sweep is gated on newness even
though its scope stays full.

A PR moved in the window. Which PRs the granted run then assesses is task.md's.
