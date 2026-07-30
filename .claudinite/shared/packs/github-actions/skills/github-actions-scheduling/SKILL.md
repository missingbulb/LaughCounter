---
name: github-actions-scheduling
description: What a GitHub Actions `schedule:` trigger actually guarantees — late fires, dropped fires, the 60-day disable — and how to build and describe scheduled work around it. Use when adding, changing, explaining, or debugging anything that runs on a cron in GitHub Actions.
---

# GitHub Actions cron is best-effort

GitHub's `schedule:` trigger is a **request to queue**, not a promise to run. A cron'd workflow
routinely fires minutes to tens of minutes late, and under load GitHub **drops** a firing
outright — the run never happens, with no failure, no notification, and nothing in the run
ledger to look at. The effect is worst at `:00` and other round minutes, where everyone's cron
lands at once. GitHub's docs concede only that a schedule "may be delayed during periods of high
loads"; the behaviour is measured across a fleet in
[Upptime's write-up](https://upptime.js.org/blog/2021/01/22/github-actions-schedule-not-working/).
Same family, different mechanism: GitHub **disables** a repo's scheduled workflows entirely
after 60 days without repository activity.

## Building for it

- **Never let correctness depend on a firing happening, or on when it happened.** Derive what is
  due from durable state the run can read — the Actions run ledger, a timestamp in the repo, the
  world the job inspects — never from "this fired, so it must be time". Wall-clock equality with
  the cron minute is not a test any real run passes.
- **Idempotent and self-catching.** A scheduled job does whatever is outstanding *now*, so a
  missed firing costs latency rather than data. Per-tick bookkeeping — counters, "the last hour's
  changes", a queue advanced one step per run — loses information the first time a tick vanishes.
  If a job cannot catch up, say so where it is declared and design the miss as an accepted loss.
- **Catch up the most recent slot only.** A job that backfills every missed slot turns an outage
  into a storm on recovery; one catch-up evaluation per frequency is the shape that survives a
  multi-day gap.
- **Pick a minute off `:00`.** Anywhere in `:10–:50` dodges the stampede and stays clear of the
  hour boundary any slot math anchors on; across a fleet, hash the repo name into that band so
  members spread rather than collide.
- **Deadline-bound work does not belong on a cron.** If something must happen *at* a time, drive
  it from the event, not an hourly poll that may skip.

## Talking about it

- **Say "about hourly, best-effort", never "hourly".** Stating an interval the platform does not
  honour turns ordinary jitter into a bug report.
- **A late or missing run is not a defect until proven one.** First question: did GitHub fire at
  all — check the workflow's run list, not the job's logic. Then: has the repo been quiet for 60
  days? Only after both does the code become a suspect. A single missed slot is expected
  behaviour.

Claudinite's own scheduler is built to this: a repo-hashed `:10–:50` minute, due-slot math
against the Actions run ledger rather than the clock, and most-recent-slot-only catch-up — see
[scheduled-tasks.md](../../../basics/scheduled-tasks.md) for the task-authoring side.
