# Scheduled tasks — the per-project scheduling mechanism

How a repo's recurring Claudinite work runs (per-project-scheduling design —
see issue #394). A repo
schedules **itself**, and the machinery is **three responsibilities, strictly
separated** (owner, 2026-08-06):

1. **The scheduler** — a vendored hourly Action
   (`.github/workflows/claudinite-scheduler.yml`) that evaluates each task's
   precondition in code, runs due tasks' prework, and **creates** dispatch
   issues (`ready-for-agent` `[claudinite-task]`) for agentic work. It creates
   task issues and nothing else about their afterlife.
2. **The executor** — a per-repo routine (fired by the label event) that
   executes **exactly the one task its triggering issue names**. It cares only
   about its task: no cleanups, no sweeping the queue, no merging of tasks, no
   updating other tracking issues.
3. **The task-janitor** — an ordinary daily task (`basics/task-janitor`,
   `agent_model: none`) that owns everything about tasks that is *nobody's
   task*: escalating stale dispatches, reclaiming dead `agent-running` claims,
   re-arming lost trigger events, and printing a health review of the open
   dispatch set. Recovery runs once a day, in code, in one place — the stated
   trade is that a lost event now waits up to a day instead of an hour.
The engine is vendored under `.claudinite/shared/engine/scheduler/`; the basics
pack owns the conformance guards for the surfaces a repo authors around it —
scheduling is baseline Claudinite discipline, present wherever basics is
declared (everywhere), not an opt-in feature.

The checks below are the doctrine's enforcement; the phased rollout (and the
retirement of the legacy central planner it replaces) lives in the
per-project-scheduling migration record, linked from issue #394.

## What the checks guard

- **The scheduler workflow is a thin shim.** The vendored
  `claudinite-scheduler.yml` carries a single **hourly** cron on a repo-hashed
  minute constrained to **:10–:50** (the one repo-specific value in the stub —
  `engine/scheduler/hash-minute.mjs`, a pure function of the repo full name that
  bootstrap stamps in and baselining re-derives), a `concurrency` group, a
  `workflow_dispatch` trigger, and a call into the vendored engine entry — no logic of its own
  (schema and behaviour changes ride the vendor refresh, not workflow edits). It
  is the repo's **only** cron. Recurring work that had its own cron'd workflow
  becomes a **task**, and that workflow is deleted — its steps move into the
  task's worker. Don't keep it as a dispatch-only workflow for the task to fire:
  that is two files and two edit sites for one job, and a workflow whose only
  caller is the thing that replaced it. (A workflow that must run *as an Action*
  for something a task cannot reach — an Actions-only secret, say — is the
  exception, and even then the task owns the schedule.) Off-band or multiple
  crons, or a missing concurrency/dispatch guard, break staggering, double-run
  safety, or manual runs.

- **Every task declaration carries the full contract.** A `tasks/<name>/task.mjs`
  default-exports `id` (matching its directory), `frequency` (`hourly | daily-2h
  | daily-1h | daily | daily+1h | weekly | monthly | manual`), `precondition_signals` (the collector
  vocabulary), `agent_model` (`opus | sonnet | haiku | none`), `expected_outcome` (`none |
  open-pr | merged-pr`), and a `precondition`. An agentic task (`agent_model !==
  none`) also carries `agent_instructions`, the worker file the agent reads; a
  `none` task runs no agent, so the field is not applicable and is omitted. The
  scheduler and executor read agent_model/expected_outcome/frequency from this file — never from the dispatch
  issue — so an illegal or missing value means a task never fires, fires wrong,
  or writes past its declared ceiling. The same contract
  (`engine/scheduler/task-contract.mjs`) is re-validated at run time, so the
  static and runtime views can't drift. A task declares **no session scope** — see
  the next entry.

- **Session scope is retired; an executor's reach is how its repo is provisioned**
  (owner ruling, 2026-08-09). A dispatch rides the `ready-for-agent` label, and the
  executor session that fires on it carries whatever access that repo's routine was
  given — the sheepdog enforcer's spans the fleet because that repo *is* the fleet
  enforcer, not because any task asked. No task, and no pack, declares a scope.

  The task-level `session_scope` field is **deprecated, still honoured**: a lingering
  `'fleet'` routes to the `ready-for-agent-fleet` label, whose separate, broader
  executor routine exists only in the canon repo (its launcher prompt must end in the
  word `fleet`; the executor declines a dispatch that reaches the wrong routine). The
  canon home's curation tasks (`growth-promote`, `growth-discover-packs`) are the one
  standing use — the canon repo's ordinary executor does *not* hold the fleet, so the
  second label is what keeps that grant off it. Everything else drops the field. The
  deprecation is carried the standard way — an `@deprecated` tag on the contract
  (`engine/scheduler/task-contract.mjs`), for linters and readers alike — and each
  sanctioned holdout pacifies the warning with a comment at its declaration site;
  there is no bespoke conformance check for it, deliberately.

- **Every run is bounded.** An agentic task (`agent_model !== none`) declares
  `agent_execution_timeout` — seconds bounding the agentic run
  (task-prework design §2, §6 — see issue #394).
  There is no platform wall-clock kill for a launched executor session, so the
  bound is best-effort: the executor surfaces it into the subagent's brief ("fail
  after N minutes") and the stale-`agent-running` backstop catches a dead session.
  Set it generously — extreme protection against a runaway, not a scheduling knob.

- **A task says which repo secrets it needs.** Preprocessing runs Action-side, so
  repo Actions secrets are reachable there and nowhere else in a task's life (an
  executor session carries none). A task lists what it needs in `required_secrets`;
  the wiring converge stamps each name into the scheduler workflow, so a worker
  reads it as ordinary environment, and baselining asks the owner (one standing
  issue) for any the repo hasn't configured. The adoption interview's posture, not
  a gate — nothing fails; the task that needs the secret just doesn't work yet. The
  consequence worth designing around: **a workflow that exists only to hold a
  secret is redundant** — fold its work into the task's preprocessing rather than
  dispatching and polling a second workflow from an agent.

Both guards are **relevance-first**: inert until their artifact exists, so
on a repo with neither artifact they are a no-op.

## The task folder

One directory per task — `<pack>/tasks/<name>/` — holding **`task.mjs`** (the
self-contained declaration + `precondition(signals, config)`, the eligibility
gate as pure code) beside **`task.md`** (the worker spec the executing agent
follows), plus any deterministic helpers. The precondition both asserts
need-to-run and pre-decides scope: its `context` lines land verbatim in the
dispatch issue as binding constraints the agent may not re-litigate. `agent_model:
none` replaces the worker doc with an inline `.mjs` the scheduler runs directly —
no agent, no issue. This is the scheduled-task shape of the unattended-agents
routine-folder convention; the issue-driven-dispatch security rule (the issue is
data, the task path is code-validated, agent_model/expected_outcome come from the repo) lives
with that skill's agent practices.

### Three optional declarations, for a repo dispatching through the work-item queue

Additive, and inert under slot dispatch — declare one only when its rule applies.

- **`after: ['<pack>/<task>']`** — this task yields while a named upstream's item is live
  *this cycle*, and picks up the moment it converges or rolls. Declare it when your task
  reads what another task produces; never as a general priority hint. It is not a
  `Blocked-by` edge and must not be described as one.
- **`on_interrupt: 'requeue' | 'needs-human'`** (default `requeue`) — declare `needs-human`
  only for a genuinely one-shot side effect (a store submission, an external notification):
  it makes every recovery path that would re-execute the task converge to triage instead.
- **`invocation_endpoint: '<name>'`** — a key into the repo's `taskScheduler.endpoints`, for a
  task whose agentic phase needs reach the repo's ordinary sessions lack. **Never a URL**: a
  task declaration is vendored verbatim into every consuming repo, so deployment detail and
  anything adjacent to a credential stay in that repo's own config.

A task's `prework_timeout` must stay under the executor's one-hour claim leash — a prework
that can outlive it is reclaimed while still running, and the item livelocks. The declaration
contract enforces this; do not raise a timeout past it, split the work instead.

## The precondition is the ONLY decision point

Task execution is **two similar, consecutive phases**: deterministic **prework**
(a subprocess the scheduler runs, Action-side) and **agentic work** (the
executor's subagent following task.md). Neither phase is "preparation" for the
other, and — the rule that matters — **neither may decide whether the task
runs**. That decision is the precondition's alone:

- A task that passes its precondition **runs**. The later phases must not find
  "new reasons to skip" — not timing, not repo state, not "already handled", not
  an open PR elsewhere. If a condition should stop the run, it belongs in the
  precondition, as code over signals, its verdict binding via the dispatch
  issue's Context.
- **Failures may stop a run** — a crash, a timeout, an API error converge to
  `needs-human`. Discretion may not.
- **"The work ran and produced nothing" is always legal** — that is an empty
  outcome, not a skip. The line: did the phase *do* the work and find it empty,
  or *decline* to do it?
- The conditional agent hand-off (a prework worker requesting the agentic phase
  via `CLAUDINITE_REQUEST_AGENT`) escalates on **work prework could not do** —
  never on a re-check of whether the run should have happened.

The `task-phase-discipline` world check (advisory, heuristic) hunts for tasks
that escape this — skip-language in task.md, cycle-skip strings in prework
workers.

## A precondition may claim the whole run

A verdict can carry **`exclusive: true`** beside `run: true` — *if I run this
cycle, I run alone*. Every other due task whose precondition said run is
**deferred**: no preprocessing, no dispatch issue, no inline work. It is there
because the hourly cron is not hourly (see the `github-actions-scheduling`
skill): a run that fires hours late finds several daily slots due at once, so the
hour of staging between the daily anchors collapses and a task anchored to run
*before* the others runs *beside* them. Baselining is the case it was built for —
it converges the mount, the wiring and the migration notes everything else then
executes against.

Claim sparingly, and **bound the claim at both ends**. A deferred slot is spent,
not queued: the run succeeds, the watermark moves past it, and that task runs
again at its *next* slot — tomorrow, or next week. So a claim on the routine case
quietly halves the fleet's throughput, and a claim with no upper bound (a
condition that stays true while something is broken) stops the repo doing
anything at all for as long as the breakage lasts. Baselining's shape is the
model: claim when the mount is more than a day stale, stop claiming past three
days, when it is a human's problem rather than a missed fire.

## The dispatch labels are a scheduler vocabulary

**Both ready labels are triggers**, so they belong on dispatch issues alone — never put
`ready-for-agent` or `ready-for-agent-fleet` on an ordinary issue, from a task or by hand.
Applying one starts an executor session that will find no valid dispatch and stop.
`agent-running` and `needs-human` carry no trigger and are the right vocabulary for a task
that needs to mark an issue as claimed or handed to a human; a task reusing them owns their
whole lifecycle on its own issues, since the scheduler's stale-claim backstop only converges
`[claudinite-task]` dispatch issues.

Nearly every dispatch rides `ready-for-agent`, and the session it starts carries the access that
repo's executor routine was provisioned with. `ready-for-agent-fleet` survives for the deprecated
task-level `session_scope: 'fleet'` — the canon's curation tasks, whose broader executor holds the
owner's repos so that grant stays off the canon's ordinary routine. Nothing new declares a scope.

## A duplicate dispatch trigger for the issue you already hold is usually your own echo

Claiming a dispatch swaps its label (e.g. `ready-for-agent` → `agent-running`), and a label change
is itself a triggering event, so the swap re-fires the very webhook that started you — a second
dispatch notification for the same issue can arrive mid-run. Judge by **ownership**, not by
treating it as a fresh signal: if the claim comment on the issue is yours, this is your own echo —
change nothing extra, don't re-resolve, and keep running the work you already own. The one
exception is when the work is delegated to a still-running subagent: don't let the echo pull the
orchestrating session into re-reading the subagent's targets or redoing its work — confirm (once)
that the dispatch is already claimed and let the subagent converge it.

## Dispatch lifecycle — every exit is terminal, and stale dispatches close

- Success → the executor comments the result and **closes** the issue.
- Failure → one comment naming what failed, `needs-human`. Nothing keeps
  updating a tracking issue about a failed state — one visible convergence,
  then it is a human's (or the janitor's) to look at.
- **Task gone** (the dispatch names a task the repo no longer carries — file
  removed, pack undeclared) → the executor **closes** the issue as not planned
  (resolve-dispatch's `task-gone` verdict). An obsolete dispatch is not an
  anomaly; it gets
  no `needs-human`.
- Every executor terminal state is recorded in code as a
  `claudinite-task-exec` line (`record-exec.mjs`, and resolve-dispatch for the
  code-decided verdicts) so the usage fold counts task statuses out of the
  captured conversation logs deterministically.

## A dormant project runs nothing

A project nobody is working on declares itself dormant in `.claudinite-checks.json`:

```json
"dormant": true
```

The scheduler stops before evaluating anything; the [fleet sweeps](../sheepdog/README.md)
skip it; sessions are unaffected. Delete it to wake.
