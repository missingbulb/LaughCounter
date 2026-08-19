# Tasks — the per-project work mechanism

How a repo's own Claudinite work runs. A repo schedules **itself**, and
every occurrence of every task is an **issue in that repo** — a `[claudinite-work]`
work item whose labels are its state. That is the work-item queue; what follows is
the contract a task is written to, not how the queue works internally.

**A cadence is one way an occurrence is created, not what a task is.** A task is a
unit of the repo's own work with a precondition, a code-work phase and optionally an
agentic-work phase; `frequency` says only how often the queue offers to run it, and
`manual` — no cadence at all — is a first-class value. Work that fires on an event,
on a condition, or on a force is a task in exactly the same sense as work that fires
nightly, and reads the same contract. Anything reachable from the executor belongs
here rather than in a workflow of its own; see the cron rule below for the narrow
case that genuinely cannot be.

Three responsibilities, strictly separated (owner, 2026-08-06):

1. **The tick** — a vendored hourly Action
   (`.github/workflows/claudinite-scheduler.yml`) that is pure label mechanics
   over the issue list: **instantiate** each recurring task's standing item when
   its anchor comes, **ready** blocked items whose wait has passed, **reclaim**
   dead executor claims. It evaluates no precondition and collects no signal.
2. **The executor** — a pull worker over the queue (the tick's post-tick drain,
   and a `labeled`-event run for latency) that picks the next ready item, claims
   it, evaluates **that one task's** precondition, runs its code-work, and either
   converges the item or hands off to an agent session.
3. **The task-janitor** — an ordinary daily task (`basics/task-janitor`,
   `agent_model: none`) that owns everything about the queue that is *nobody's
   task*: items stuck ready past their period, items wearing no state label after
   a torn transition, and a health review of the open set.

The engine is vendored under `.claudinite/shared/engine/scheduler/`; the basics
pack owns the conformance guards for the surfaces a repo authors around it —
scheduling is baseline Claudinite discipline, present wherever basics is
declared (everywhere), not an opt-in feature.

There is no watermark and no per-run state: an occurrence exists because its
issue exists, which is why an outage self-heals by looking at the queue rather
than by replaying a ledger.

## What the checks guard

- **The scheduler workflow is a thin shim.** The vendored
  `claudinite-scheduler.yml` carries a single **hourly** cron on a repo-hashed
  minute constrained to **:10–:50** (the one repo-specific value in the stub —
  `engine/scheduler/hash-minute.mjs`, a pure function of the repo full name that
  bootstrap stamps in and baselining re-derives), a `concurrency` group, a
  `workflow_dispatch` trigger (whose one `wake` input is how a task is forced,
  here or from another repo), and a call into the vendored tick — no logic of its own
  (schema and behaviour changes ride the vendor refresh, not workflow edits). It
  is the repo's **only** cron; the executor's workflow beside it carries none. Work
  that had its own cron'd workflow becomes a **task**, and that workflow is deleted
  — its steps move into the task's worker. So does work with no cron at all: an
  event-driven or condition-gated job becomes a task on `frequency: 'manual'`, woken
  by whatever knows the event happened. Don't keep either as a dispatch-only workflow
  for the task to fire: that is two files and two edit sites for one job, and a
  workflow whose only caller is the thing that replaced it. (A workflow that must run
  *as an Action* for something a task cannot reach — an Actions-only secret, an OIDC
  identity a deploy target demands — is the exception. Even then the task owns the
  trigger and the decision to run; the workflow carries only the step that needs the
  Action's own privileges.) Off-band or multiple
  crons, or a missing concurrency/dispatch guard, break staggering, double-run
  safety, or manual runs.

- **Every task declaration carries the full contract.** A `tasks/<name>/task.mjs`
  default-exports `id` (matching its directory), `frequency` (`hourly | daily-2h
  | daily-1h | daily | daily+1h | weekly | monthly | manual`), `precondition_signals` (the collector
  vocabulary), `agent_model` (`opus | sonnet | haiku | none`), `expected_outcome` (`none |
  open-pr | merged-pr`), and a `precondition`. An agentic task (`agent_model !==
  none`) also carries `agent_instructions`, the worker file the agent reads; a
  `none` task runs no agent, so the field is not applicable and is omitted. The
  tick and executor read agent_model/expected_outcome/frequency from this file — never from the work
  item — so an illegal or missing value means a task never fires, fires wrong,
  or writes past its declared ceiling. The same contract
  (`engine/scheduler/task-contract.mjs`) is re-validated at run time, so the
  static and runtime views can't drift. A task declares **no session scope** — see
  the next entry.

- **A task's code reads only the environment code-work is handed.** Code-work runs as
  a subprocess with a fixed set of `CLAUDINITE_*` variables — `REPO_ROOT`, `REPO`,
  `DEFAULT_BRANCH`, `ITEM`, `PACK`, `TASK`, `CONTEXT`, `REQUEST_AGENT` — and
  `task-code-work-env` (blocking) rejects a read of anything else. A variable nobody
  sets is `undefined`, the parse of it yields empty, and the run goes green having
  quietly done something other than what it was asked: that is how three fleet
  tasks kept taking their parameters through a channel the queue had stopped
  setting, leaving a fleet-wide sweep unable to be scoped or dry-run. **Operator
  parameters ride the item's Context** (`CLAUDINITE_CONTEXT`, one line per bullet),
  which is the only channel a task may take them from.

- **Session scope is retired, and `session_scope` is now inert** (owner ruling,
  2026-08-09; the field's last reader went with the slot scheduler). Reach is a
  property of **which endpoint the hand-off calls** — `invocation_endpoint`, below
  — so a task needing wider access names a different endpoint and nothing else in
  the system has a concept of scope. A declaration still carrying `session_scope`
  validates and does nothing at all; `task-declaration-shape` raises it as an
  advisory rename (advisory on purpose: a member's vendor refresh must not turn its
  CI red over a file nothing has edited yet). Drop it, and name an endpoint if the
  task actually needed the reach.

- **Every run is bounded.** An agentic task (`agent_model !== none`) declares
  `agent_execution_timeout` — seconds bounding the agentic run
  (task-code-work design §2, §6 — see issue #394).
  There is no platform wall-clock kill for a launched agent session, so the
  bound is best-effort: the hand-off surfaces it into the session's brief ("fail
  after N minutes") and the agent leash catches a session that never converges its
  item. Set it generously — extreme protection against a runaway, not a scheduling
  knob.

- **A task says which repo secrets it needs.** Code-work runs Action-side, so repo
  Actions secrets are reachable there and nowhere else in a task's life (an agent
  session carries none). A task lists what it needs in `required_secrets`; the
  wiring converge stamps each name into the workflows that run code-work — the tick's
  drain and the executor — so a worker reads it as ordinary environment. A declared
  secret the repo has not configured is **named, not guessed at**: code-work is the
  only code that sees a secret's value, so the executor converges the item to
  `needs-human` saying exactly which one is missing. Nothing else fails; the task
  that needs the secret just doesn't work yet. The consequence worth designing
  around: **a workflow that exists only to hold a secret is redundant** — fold its
  work into the task's code-work rather than dispatching and polling a second
  workflow from an agent.

- **A standing tracker belongs to the task that keeps one, not to the machinery.**
  Nothing in the contract declares a tracker and no task is expected to want one. A
  task that keeps an aggregated record across runs resolves the issue in its **own**
  code-work and passes the number to its agentic phase the ordinary way — the hand-off
  payload's `delivered.issue`, which the executor renders into the work item as an `Issue:` line
  the worker doc points at. The exact-title lookup and the create-then-close pair are
  a library that code-work may call (`engine/scheduler/tracker.mjs`), never a phase:
  whether a run with nothing to say should mint a tracker at all is the task's own
  judgment, and tidy-repo's three answer no.

Both guards are **relevance-first**: inert until their artifact exists, so
on a repo with neither artifact they are a no-op.

## The task folder

One directory per task — `<pack>/tasks/<name>/` — holding **`task.mjs`** (the
self-contained declaration + `precondition(signals, config)`, the eligibility
gate as pure code) beside **`task.md`** (the worker spec the executing agent
follows), plus any deterministic helpers. The precondition both asserts
need-to-run and pre-decides scope: its `context` lines join the item's own
Context as binding constraints the agent may not re-litigate. `agent_model:
none` replaces the worker doc with an inline `.mjs` the executor runs as code-work
— no agent phase, and the item closes on that subprocess's outcome. This is the
scheduled-task shape of the unattended-agents routine-folder convention; the
issue-driven-dispatch security rule (the issue is data, the task path is
code-validated, agent_model/expected_outcome come from the repo) lives with that
skill's agent practices.

### Three optional declarations

Declare one only when its rule applies.

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

A task's `code_work_timeout` must stay under the executor's one-hour claim leash — a code-work
that can outlive it is reclaimed while still running, and the item livelocks. The declaration
contract enforces this; do not raise a timeout past it, split the work instead.

## The precondition is the ONLY decision point

Task execution is **two similar, consecutive phases**: deterministic **code-work**
(a subprocess the executor runs, Action-side) and **agentic work** (the session
the executor hands off to, following task.md). Neither phase is "preparation" for the
other, and — the rule that matters — **neither may decide whether the task
runs**. That decision is the precondition's alone:

- A task that passes its precondition **runs**. The later phases must not find
  "new reasons to skip" — not timing, not repo state, not "already handled", not
  an open PR elsewhere. If a condition should stop the run, it belongs in the
  precondition, as code over signals, its verdict binding via the item's
  Context.
- **Failures may stop a run** — a crash, a timeout, an API error converge the
  item to `needs-human`. Discretion may not.
- **"The work ran and produced nothing" is always legal** — that is an empty
  outcome, not a skip. The line: did the phase *do* the work and find it empty,
  or *decline* to do it?
- The conditional agent hand-off (a code-work worker requesting the agentic phase
  via `CLAUDINITE_REQUEST_AGENT`) escalates on **work code-work could not do** —
  never on a re-check of whether the run should have happened.

The `task-phase-discipline` world check (advisory, heuristic) hunts for tasks
that escape this — skip-language in task.md, cycle-skip strings in code-work
workers.

## Ordering between tasks is `after`, not a claim on the run

A task that reads what another task produces declares **`after:
['<pack>/<task>']`**: its item yields while that upstream's item is live this
cycle, and picks up the moment the upstream converges or rolls. Nothing else
orders tasks — there is no run to claim, because there is no run: each item is
picked, decided and executed on its own, so a task that must go second says which
task it goes after and the queue holds it there.

Declare it only for a real read-what-it-produces dependency, never as a general
priority hint, and never describe it as a `Blocked-by` edge — that is a different
field with different semantics. A yielded item is not spent: it waits, and runs in
the same cycle once the upstream is out of the way.

## The queue labels are the item's state, and only the queue writes them

A work item's **state is its labels**, and there is exactly one state label on it
at a time: `task:blocked` (waiting on a `Not-before` or a `Blocked-by`),
`task:ready` (available to pick), `task:executing` (an executor holds the claim),
`task:agent` (a session owns it). Beside them: `task:urgent` (pick before anything
non-urgent), `origin:schedule` (the tick created this one at an anchor), and the
terminal set — `outcome:done`, `outcome:delivered`, `outcome:obsolete`,
`needs-human`.

Two rules follow, and both are about not borrowing the vocabulary:

- **Never put a queue label on an ordinary issue**, from a task or by hand. The
  tick and the executor read them as state, and a label on an issue that is not a
  `[claudinite-work]` item is either ignored or misread — neither is what the
  person applying it meant.
- **A task that wants its own tracking issue owns that issue's whole lifecycle**,
  in its own vocabulary. `needs-human` is the one word shared with the queue, and
  a task reusing it is on the hook for clearing it: nothing sweeps an issue that
  is not a work item.

Label writes are always **granular** — add and remove named labels, never write
the label set. A set-write replaces from a stale snapshot and clobbers a
concurrent transition, and with a tick and several executors moving labels at
once that is a correctness rule rather than a style preference.

## An item's identity is its issue number, and a hand-off carries a nonce

There is no slot id and no occurrence id beside the issue: **`#<n>` is the
occurrence**. It is what a `claudinite-task-exec` record's bracketed field
carries, and the only thing tying that record back to the work it describes.

A hand-off is an **API call**, not a label event — the executor invokes the
session directly and stamps a nonce on the item first. So a session proves it is
this item's session in code before acting: the task file exists at HEAD, its pack
is declared, the title names that task, the item carries `task:agent`, and the
newest hand-off comment carries the nonce it was given. A nonce mismatch means
the fire named a hand-off that is not the current one — the item belongs to
someone else, or to an earlier episode — and the session stops without labelling,
closing or running anything.

## Item lifecycle — every exit is terminal, and nothing keeps updating

- **Succeeded, nothing pending** → `outcome:done`, one comment, issue closed.
- **Succeeded and left a live artifact** the world still has to act on — an open
  PR, an armed auto-merge, a store submission → `outcome:delivered`, closed.
- **Failed or anomalous** → `needs-human`, one comment naming what failed, issue
  left open. Nothing keeps updating an issue about a failed state: one visible
  convergence, then it is a human's to look at. Re-queueing it by hand
  (`create-work-item --wake #<n>`) is the sanctioned road back, and the
  precondition is re-evaluated at that pickup — which is what makes the retry safe
  even when the failed run half-did its work.
- **Never ran** → `outcome:obsolete`, closed as not planned: the precondition
  declined and the item has no anchor to roll to, or the task is gone (file
  removed, pack undeclared). An obsolete item is not an anomaly and gets no
  `needs-human`.
- **Declined with an anchor to roll to** → not terminal at all. The item's
  `Not-before` is bumped to its next anchor and it returns to `task:blocked`. The
  bump *is* the record: no comment, because an hourly task that stayed quiet would
  otherwise fill its own timeline.
- Every terminal state is recorded in code as a `claudinite-task-exec` line
  (`record-exec.mjs`), so the usage fold counts task statuses out of the captured
  conversation logs deterministically.

## A dormant project runs nothing

A project nobody is working on declares itself dormant in `.claudinite-checks.json`:

```json
"dormant": true
```

The tick instantiates, readies and reclaims nothing, and the executor picks
nothing up; the [fleet sweeps](../sheepdog/README.md) skip it; sessions are
unaffected. Delete it to wake — a dormant spell is not replayed, so the repo
simply starts scheduling again from now.
