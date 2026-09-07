---
name: writing-tasks
description: The contract a Claudinite task is written to — the declaration's fields, the code-work and agentic phases, the precondition as the only decision point, ordering, and how a work item converges. Use when writing or changing a tasks/<name>/task.json or its worker, or when a task-declaration check fires.
metadata:
  force-load-on-file-edits-paths:
    - "**/tasks/**"
---

# Writing a task

Every occurrence of every task is an issue in this repo — a `[claudinite-work]` item whose labels
are its state — so write the task against that queue, never a runner of its own.

**A cadence is one of a task's conditions, not what a task is.** A task is a unit
of the repo's own work with preconditions, a code-work phase and optionally an
agentic-work phase; its `preconditions` say when the queue runs it — a cadence term
(`due:daily`, `last-run-over:7d`) beside whatever else must hold — or no
`preconditions` at all, for work that runs only from an item somebody created. Work
that fires on an event, on a condition, or on a force is a task in exactly the same
sense as work that fires nightly, and reads the same contract. Anything reachable
from the executor belongs here rather than in a workflow of its own; see the cron
rule below for the narrow case that genuinely cannot be.

Three responsibilities, strictly separated (owner, 2026-08-06):

1. **The scheduler run** — a vendored Action
   (`.github/workflows/claudinite-scheduler.yml`, two ticks a day) over the issue
   list: **ask** every task on the schedule, through its own preconditions,
   whether it wants to run now, and file its item only on a yes — a no is a log
   line, and the next tick asks again; **ready** blocked items whose wait has
   passed; **reclaim** dead executor claims. It keeps no calendar and no state:
   a task's cadence is one of its conditions, read off its own run history in
   the queue.
2. **The executor** — a pull worker over the queue (the scheduler run's post-scheduler run drain,
   and a `labeled`-event run for latency) that picks the next ready item, claims
   it, evaluates **that one task's** precondition, runs its code-work, and either
   converges the item or hands off to an agent session.
3. **The task-janitor** — an ordinary daily task (`claudinite-tasks/task-janitor`,
   `agent_model: none`) that owns everything about the queue that is *nobody's
   task*: items stuck ready past their period, items wearing no state label after
   a torn transition, and a health review of the open set.

The engine is vendored under `.claudinite/shared/packs/claudinite-tasks/`; the basics
pack owns the conformance guards for the surfaces a repo authors around it —
scheduling is baseline Claudinite discipline, present wherever basics is
declared (everywhere), not an opt-in feature.

There is no watermark, no per-run state and no calendar: an occurrence exists
because its issue exists, and a task's history is its issues, which is why an
outage self-heals by looking at the queue rather than by replaying a ledger.

## What the checks guard

- **The scheduler workflow is a thin shim.** The vendored
  `claudinite-scheduler.yml` carries a single cron — two ticks a day, at the
  repo's `dailyHour` and twelve hours later, every task asked at both — on a
  repo-hashed minute constrained to **:10–:50** (the one repo-specific value in
  the stub — `packs/claudinite-tasks/hash-minute.mjs`, a pure function of the repo full name that
  bootstrap stamps in and baselining re-derives), a `concurrency` group, a
  `workflow_dispatch` trigger (whose one `wake` input is how a task is forced,
  here or from another repo), and a call into the vendored scheduler run — no logic of its own
  (schema and behaviour changes ride the vendor refresh, not workflow edits). It
  is the repo's **only** cron; the executor's workflow beside it carries none. Work
  that had its own cron'd workflow becomes a **task**, and that workflow is deleted
  — its steps move into the task's worker. So does work with no cron at all: an
  event-driven or condition-gated job becomes a task declaring `trigger: 'request'`,
  woken by whatever knows the event happened.
  Don't keep either as a dispatch-only workflow for the task to fire: that is two files and two edit sites for one job, and a
  workflow whose only caller is the thing that replaced it. (The exception is narrow,
  and it is **not** about privilege. An Actions-only secret is reachable from
  code-work, which runs Action-side — `code_work_required_secrets`, below. A deploy target's
  OIDC identity is one `permissions:` line in the executor's own workflow, not a wall.
  A one-shot external effect is handled by `on_interrupt: 'needs-human'`, not by
  escaping to a workflow. What genuinely does not fit is the Actions **composition
  model**: a `uses:` step is resolved by the runner out of workflow YAML, and code-work
  is itself a step's subprocess, so no task — in any language — can invoke one. Work
  built on marketplace or composite actions, a Pages deploy being the standing example,
  keeps a workflow for those steps. Even then the task owns the trigger and the
  decision to run; the workflow carries only the `uses:` steps.) Off-band or multiple
  crons, or a missing concurrency/dispatch guard, break the ticks, double-run
  safety, or forced runs.

- **Every declaration carries a `description`** — up to fifty words on what the
  task does, or why it exists, for whoever reads the declaration or a roster of
  them. It says only what no other field says: never the cadence, the conditions,
  the automerge policy, or where the files live — those are read off the fields
  beside it, and a description restating them goes stale the day one changes.
  `task-declaration-shape` bounds the length; the rest is yours.

- **Every task declaration carries the full contract.** A `tasks/<name>/task.json`
  (one JSON object, `"$schema"` pointing at `packs/claudinite-tasks/task.schema.json`
  so an editor validates it; keys grouped as identity, scheduling, outcome, then the
  `code_*` fields, then the `agent_*` fields) declares `id` (matching its directory), `description`
  (below), `trigger` (`schedule | request` — who mints an occurrence, below),
  `preconditions` (what must then hold — optional, and absent means nothing does; its
  first entry is normally the cadence term, below), `expected_outcome` — what the run does to
  pull requests, resolved once by the executor before code-work and handed to both
  phases: `no_code_changes` (opens none), `fresh_pr` (one on a freshly minted
  branch; the task's earlier pull requests are left alone),
  `amend_existing_or_create_new_pr` (pushes onto the task's newest open pull
  request while it has no conflicts, a fresh branch otherwise), or
  `supersede_existing_pr` (a fresh branch, and the task's earlier pull requests
  close once its own exists; a green, unlanded one on an auto-merge repo is landed
  instead). The retired `none`/`pr` normalize to the first two, and
  `open-pr`/`merged-pr` to `fresh_pr` with a policy of `nothing`/`anything`.
  Everything else has a default or is conditional: `agent_model`
  (`opus | sonnet | haiku | none`) is `none`, no agent; `code_work` is no code work.
  The two timeouts have **no default**: an agent declares `agent_execution_timeout`
  and code work declares `code_work_timeout`, because a running phase always has a
  bound. An agent also declares `agent_instructions`, its worker file — nothing
  stands in for it. A task whose outcome opens a pull request may also carry
  `automerge` — what it authorizes to land unreviewed: `'nothing'` (the default
  when absent), `'anything'`, or a list of diff classes, each optionally `reject:`-prefixed.
  Choose the **narrowest policy that covers the task's whole write surface** — the
  policy is the contract's statement of why landing unattended is safe, and the
  policy engine plus the `automerge-policy-scope` check hold every run to it.
  **Start from the folder.** A task's write surface is almost always a *place* —
  the tree its worker is told to write in, which you know exactly while writing
  this declaration — and a folder bound holds where a kind bound does not:
  `doc-changes` authorizes Markdown anywhere in the repo, the root `README.md`
  included, where `under:<dir>` authorizes one tree and a run that strays parks.
  So name the tree inline first, then narrow it by kind where the task writes
  only one — **a list is a union, so adding a term widens; `&&` inside a term
  narrows**, every part having to match (`under:product-wiki && doc-changes` is
  "docs, and only under that folder"). Leave the scope bare where the task
  legitimately writes more than one kind: a bare `under:<dir>` covers the code
  and the test beside it, where intersecting a code class would park the run the
  moment its own test file joined the diff. Reach for a bare kind class only
  where the task genuinely writes repo-wide, as a comment sweep does. A pack
  declares its own class (a `merge-rules.json` beside its `pack.mjs`) only when a
  task knows a finer boundary than a class or a folder can state — a file-name
  matcher, or a grant like the mount rewrite's. A `none` task runs no agent, so
  `agent_instructions` is not applicable and is omitted. The
  scheduler run and executor read agent_model/expected_outcome/preconditions from this file — never from the work
  item — so an illegal or missing value means a task never fires, fires wrong,
  or writes past its declared ceiling. The same contract
  (`packs/claudinite-tasks/task-contract.mjs`) is re-validated at run time, so the
  static and runtime views can't drift. A task declares **no session scope** — see
  the next entry.

- **A task's code reads only the environment code-work is handed.** Code-work runs as
  a subprocess with a fixed set of `CLAUDINITE_*` variables — `REPO_ROOT`, `REPO`,
  `DEFAULT_BRANCH`, `ITEM`, `PACK`, `TASK`, `CONTEXT`, `REQUEST_AGENT`, and the
  target's `TARGET_MODE`, `TARGET_BRANCH`, `TARGET_PR` — and
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
  `agent_execution_timeout` — seconds bounding the agentic run.
  There is no platform wall-clock kill for a launched agent session, so the
  bound is best-effort: the hand-off surfaces it into the session's brief ("fail
  after N minutes") and the agent leash catches a session that never converges its
  item. Set it generously — extreme protection against a runaway, not a scheduling
  knob. (1)

- **A task says which repo secrets it needs.** Code-work runs Action-side, so repo
  Actions secrets are reachable there and nowhere else in a task's life (an agent
  session carries none). A task lists what it needs in `code_work_required_secrets`
  (the retired `required_secrets` still normalizes to it); the
  executor holds every repo secret and hands each task's code-work exactly the names
  that task declared, so a worker reads it as ordinary environment. A declared
  secret the repo has not configured is **named, not guessed at**: code-work is the
  only code that sees a secret's value, so the executor parks the item at
  `task:status:needs-human-action` saying exactly which one is missing. Nothing else fails; the task
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
  a library that code-work may call (`packs/claudinite-tasks/tracker.mjs`), never a phase:
  whether a run with nothing to say should mint a tracker at all is the task's own
  judgment, and a task whose output is its PR answers no.

`task-declaration-shape` and `task-md-only-when-agentic` are **relevance-first**:
both key off a `tasks/<name>/task.json` existing, so on a repo that carries no tasks
they are a no-op.

## The task folder

One directory per task — `<pack>/tasks/<name>/` — holding **`task.json`** (the
declaration, plain data) beside its worker, plus any deterministic helpers and,
where the task's gate is its own, a **`preconditions.mjs`** exporting its terms.
The conditions that grant a run also contribute the run's `context` lines, which
join the item's own Context as binding constraints the agent may not re-litigate.

**The worker is code by default, and the agent is the escalation.** An
`agent_model: none` task's worker is a sibling `.mjs` the executor runs as
code-work: the item closes on that subprocess's outcome and no session is ever
started, which is how a repo runs a deterministic job in Actions without
authoring a workflow for it. An agentic task adds **`task.md`**, the spec its
session follows, and may still do its own code-work first — escalating the
remainder for **work code-work could not do**, never for a re-check of whether
the run should have happened.

`task.md` is that spec and nothing else, so an agentless task must not carry one
(`task-md-only-when-agentic`, blocking): the file's presence is what the rest of
the corpus reads as "an agent runs here" — the routine contract judges the folder
by it, and every work item names it as the file its run is about. What an
agentless task's worker does is documented in a **`README.md`** beside it.

**`task.md` describes only what this task must do — never how anything outside it
works.** A session opens the file already dispatched, already at its model, already
holding its item; restating that machinery teaches it nothing and is read as
instruction, so a later run generalizes the description into a rule and acts on it.
Keep out how the task is invoked (the executor, the hand-off, the queue's labels),
what model it was dispatched at, and what downstream consumes what it produces.
Where such a fact carries a constraint the run must obey, state the **constraint**
and drop the mechanism: not "you run from a work item the executor handed off whose
Context is binding scope", but "the Context section is binding scope"; not "never
merge — the executor enforces it in code", but "never merge". The declaration is
where the mechanics belong: `agent_model`, `schedule_after`, `expected_outcome` and
`automerge` live in `task.json`, and `task.md` never repeats them.

**What happens to the run's pull request is never in `task.md`** — not whether it
merges itself, not what it authorizes to land unreviewed, not what becomes of an
earlier run's still-open one. Say what this run must do (open a PR, never merge
it, what its body must carry), point at the shared delivery procedure
([deliver-pr.md](../../../claudinite-tasks/deliver-pr.md)) where the run must
invoke one, and stop. Watch for the spelled-out form, which names no field and so
reads as ordinary instruction: "an earlier round's pull request closes as
superseded once yours exists" *is* `expected_outcome`. (2)

This is the task-folder shape of the unattended-agents routine-folder convention; the
issue-driven-dispatch security rule (the issue is data, the task path is
code-validated, agent_model/expected_outcome come from the repo) lives with that
skill's agent practices.

### Three optional declarations

Declare one only when its rule applies.

- **`schedule_after: ['<pack>/<task>']`** — this task yields while a named upstream's item is live
  *this cycle*, and picks up the moment it converges. Declare it when your task
  reads what another task produces; never as a general priority hint. It is not a
  `Blocked-by` edge and must not be described as one.
- **`on_interrupt: 'requeue' | 'needs-human'`** (default `requeue`) — declare `'needs-human'`
  only for a genuinely one-shot side effect (a store submission, an external notification):
  it makes every recovery path that would re-execute the task converge to triage instead.
- **`invocation_endpoint: '<name>'`** — a key into the repo's `taskScheduler.endpoints`, for a
  task whose agentic phase needs reach the repo's ordinary sessions lack. **Never a URL**: a
  task declaration is vendored verbatim into every consuming repo, so deployment detail and
  anything adjacent to a credential stay in that repo's own config.

One field is **not** yours to declare: `model_from_request`, which lets a task run
at the model its ITEM names rather than the one it declares. Exactly one task
declares it — the engine's own built-in request implementer, which no pack can be —
and every other task names its own `agent_model`.

A task's `code_work_timeout` must stay under the executor's one-hour claim leash — a code-work
that can outlive it is reclaimed while still running, and the item livelocks. The declaration
contract enforces this; do not raise a timeout past it, split the work instead.

## Writing `preconditions`

**`preconditions` is a list of named conditions, and every one must hold.**
`['X', 'Y || Z']` is `X && (Y || Z)`: the comma is `&&`, `||` joins alternatives
inside one entry, and a parameterized condition carries its argument inline after
a colon (`no-open-pr-touching:product-wiki/`). It is deliberately the opposite of
an `automerge` list, which is a union — one field grants, the other requires.

```json
"preconditions": ["due:weekly", "substantive-change", "commits-outside:.claudinite/"]
```

**`trigger` says who asks; `preconditions` says what must hold.** Every scheduler
tick asks every task declaring `trigger: 'schedule'`; a `trigger: 'request'` task is
asked by nobody and runs only from an item somebody creates — a hand-created item, a
mark, a `--wake`, a chain link (what the retired `frequency: manual` meant). The
conditions are then judged the same way whichever of the two produced the
occurrence, so write no term for "somebody created my item": that is true of every
run, so it states nothing; and `none` is retired, an explicit empty marker being a
second spelling of an empty list. A `request` task may still state conditions, and
they hold it back exactly as they would a scheduled one — except a **cadence term**,
which on a `request` task is inert and is rejected: every item of such a task is one
somebody created, every such item carries `Woken:`, and a wake stands in for the
cadence, so the term can never decline a run.

**The first condition says how often.** Three built-ins read the task's own run
history (its unqualified `[claudinite-work]` items over the last 40 days), and they
are judged before anything else is collected, so a task whose cadence declines costs
no read:

- `due:<daily|weekly|monthly>` — no run since that cadence's most recent anchor on
  the repo's `taskScheduler` schedule; fixed hours, so the hour never drifts.
- `last-run-over:<12h|1d|7d>` — the newest run started more than that long ago;
  the hour drifts by up to a tick's gap each period.
- `last-run-not-failed` — the newest run does not stand at a failure park.
  Declare it where a run past the task's own failure would repeat the fault;
  absent it, the next occurrence is filed beside the park.

A `due:` or `last-run-over:` term holds on a woken item — the wake stands in for
the cadence — while every other condition still applies. A scheduled task with a
movement condition and no cadence term is legal and runs whenever the movement is
there, at most once per tick. One pairing is rejected outright: a `schedule` task
whose expression names a term reading the item itself (`needsItem`, which only the
built-in request implementer's `request-eligible` declares) has nothing to be judged
against at a tick, so it would fail every hour rather than decline — such a task is
`trigger: 'request'`.

A declaration still carrying `frequency` is rewritten at the door into its cadence
term plus `trigger: 'schedule'` (`manual` into `trigger: 'request'` and no
expression), and one stating no `trigger` has it derived from the shape of its
conditions; both are reported by `legacy-task-fields`, and the nightly update writes
them into a member's own task files. Write both fields.

**`preconditions` is the only gate there is.** The `precondition` function and its
`precondition_signals` companion are retired: both are rejected by name, and the
signal union is derived from the conditions — each names what it reads, so the
collector can never disagree with the gate. A gate the built-ins cannot express is
a **task-local term** in a `preconditions.mjs` beside the declaration, which is
handed `{ arg, config, item, windowDays, now, schedule }` and stays pure over them.

**Three things are NOT preconditions**, and putting them there is the common
mistake:

- **Repo shape.** "This repo ships the release pipeline", "this repo has a
  vendored mount" are facts adoption settled, not questions worth re-asking every
  night. A repo that carries a pack but not one task's subject names that task in
  its own `.claudinite-settings.json` — `taskScheduler.disabledTasks:
  ['<pack>/<task>']` — which the scheduler reads before asking anything.
- **Scope.** Which files, PRs or members a granted run works on is the worker's
  decision, made in the work sections from the same signals. The conditions decide
  run or no-run, nothing else.
- **Standing instruction and config** — a `pack_paths` list, a read-only
  constraint. Those belong in `task.md`, where they hold on every run.

### No task runs on a silent repo unless its declaration says so

A repo is *silent* over a window when no substantive commit landed, no issue or PR
of its own moved, and no session was captured — **and a scheduled task's own output
counts as silence**: a task-authored commit or PR is the machinery running, not the
project moving, and a fleet of tasks must not keep each other awake. The delivery
lanes stamp `Claudinite-Task: <pack>/<task>` on what they commit and merge, and the
movement conditions read it, so this holds for a task added tomorrow with nothing
to remember.

The vocabulary carries the gate; no operator or marker states it:

- **Movement conditions are non-task by construction** — `substantive-change`,
  `issues-touched`, `prs-touched` — so a movement-gated task is already
  silence-safe.
- **A cadence-only task that should sleep on a silent repo states
  `repo-active`** beside its cadence, the positive umbrella over all four
  activity dimensions.
- **A task whose trigger is not repo movement states its cadence term and
  nothing about the repo** (`["due:daily"]`, `["due:monthly"]`, or no
  `preconditions` at all), and that absence is visible where a reader audits
  the trigger.

### When no built-in condition fits

Ship a **`preconditions.mjs` beside the `task.json`**, exporting `terms`: a map from
term name to `{ signals, takesArg?, holds(signals, { arg, config, item, windowDays, now, schedule }) }`, where
`holds` returns `{ holds, reason?, context? }` or `{ error }`. Names resolve
against the built-ins first, then the task's own, in one flat namespace where a
collision is loud. Reach for it when the gate is genuinely this task's — an age
against a configured retention, a manifest against a release tag, a permission
check about one named issue — never to re-spell a condition the vocabulary has.

A term is handed **this occurrence's own facts** as `item`, for a verdict about one
target where the signals describe a window: a request item's verdict is about the
issue it names, which no signal bundle can single out.

### It fails LOUD, never closed

An unknown condition, a malformed argument, or a signal that could not be read
returns `{ error }` — a failed run parked in the failure lane, where the re-queue
lever retries it — never a decline. A decline is a decision about the world, and
one taken on data that was not there is permanent, silent staleness: nothing in the
repo goes red when a task quietly stops running.

## Which pull request a run works on is the executor's decision

A worker never looks for an open pull request, never picks a branch name and never
closes a previous run's pull request. The executor resolves all of that from the
task's `expected_outcome` before code-work starts and hands it in — code-work reads
`CLAUDINITE_TARGET_BRANCH` (the branch to push to), `CLAUDINITE_TARGET_PR` (the pull
request to push onto, set only when the run amends one) and `CLAUDINITE_TARGET_MODE`;
an agent session reads the same as `Target-branch:`, `Target-pr:` and `Supersedes:`
fields on its item. A code-work lane that lands a pull request takes them as
parameters (`deliverGenerated`'s `branch`/`pr`); a task with a pull request to report
names it in the hand-off payload's `delivered.pr`, which is what tells the executor a
`supersede_existing_pr` run's successor now exists.

## The precondition is the ONLY decision point

Task execution is **two similar, consecutive phases**: deterministic **code-work**
(a subprocess the executor runs, Action-side) and **agentic work** (the session
the executor hands off to, following task.md). Neither phase is "preparation" for the
other, and — the rule that matters — **neither may decide whether the task
runs**. That decision is the preconditions' alone:

- A task whose preconditions hold **runs**. The later phases must not find
  "new reasons to skip" — not timing, not repo state, not "already handled", not
  an open PR elsewhere. If a condition should stop the run, it belongs in
  `preconditions`, as a named condition over signals.
- **Failures may stop a run** — a crash, a timeout, an API error park the
  item at a `task:status:needs-human-*`. Discretion may not.
- **A failing worker may say why it failed.** The executor sees an exit code and
  nothing more, so it cannot tell a token missing a scope (a person's five-second
  fix) from an exception in the worker's own code (a bug). A worker that knows
  prints one line on either stream before exiting non-zero, and the park is routed
  by it:

  ```
  claudinite-needs-human: action — FLEET_GITHUB_TOKEN lacks Actions: write
  ```

  The kind is `action`, `decision`, `approval` or `failure`; the last marker in the
  output wins, so a worker sweeping many targets may revise its verdict as it goes.
  No marker — and every worker written before this existed — parks at `failure`,
  which is the lane that means "someone reads the trace".
- **"The work ran and produced nothing" is always legal** — that is an empty
  outcome, not a skip. The line: did the phase *do* the work and find it empty,
  or *decline* to do it?
- The conditional agent hand-off (a code-work worker requesting the agentic phase
  via `CLAUDINITE_REQUEST_AGENT`) escalates on **work code-work could not do** —
  never on a re-check of whether the run should have happened.

The `task-phase-discipline` world check (advisory, heuristic) hunts for tasks
that escape this — skip-language in task.md, cycle-skip strings in code-work
workers.

## Ordering between tasks is `schedule_after`, not a claim on the run

A task that reads what another task produces declares **`schedule_after:
['<pack>/<task>']`**: its item yields while that upstream's item is live this
cycle, and picks up the moment the upstream converges. Nothing else
orders tasks — there is no run to claim, because there is no run: each item is
picked, decided and executed on its own, so a task that must go second says which
task it goes after and the queue holds it there.

Declare it only for a real read-what-it-produces dependency, never as a general
priority hint, and never describe it as a `Blocked-by` edge — that is a different
field with different semantics. A yielded item is not spent: it waits, and runs in
the same cycle once the upstream is out of the way.

## The queue labels are the item's state, and only the queue writes them

A work item's **state is its labels**, and there is exactly one state label on it
at a time: `task:status:blocked` (waiting on a `Not-before` or a `Blocked-by`),
`task:status:waiting-for-executor` (available to pick), `task:status:running-executor`
(an executor holds the claim), `task:status:running-agent` (a session owns it).
Beside them: the item's lifelong `task:origin:*`, `task:urgent` (pick before anything
non-urgent), and the ends — `task:status:done`, `task:status:rejected`, and the four
`task:status:needs-human-*` parks. Every spelling any older engine wrote is still
read; none is written.
(A closed item may still wear the retired `outcome:*` spellings of the first two,
or `outcome:delivered`, which nothing writes any more; every reader accepts them.)

Whether an item is a task's **standing occurrence** or an **ad-hoc run** is not a
label but a property of the item: the standing one is titled with the task and
nothing else, and its task is on the schedule (`isScheduledTask`). An unscheduled
task's item and every qualified one — a fan-out target, a request naming its issue
— are ad-hoc, which is what lets them run beside the schedule rather than consuming
it; the run-history terms read every one of them as woken.

**`Woken: <instant>`** in the item's machine block is what those terms read on a
standing item: every lever that creates or wakes an item by hand stamps it —
`create-work-item`, a forced mint, `--wake` — and an item the scheduler filed on
its own never carries it. Never stamp it by hand: it is the record of somebody
asking, and the cadence terms hold on it.

Two rules follow, and both are about not borrowing the vocabulary:

- **Never put a queue label on an ordinary issue**, from a task or by hand. The
  scheduler run and the executor read them as state, and a label on an issue that is not a
  `[claudinite-work]` item is either ignored or misread — neither is what the
  person applying it meant.
- **A task that wants its own tracking issue owns that issue's whole lifecycle**,
  in its own vocabulary. A park is the one state shared with the queue, and
  a task reusing it is on the hook for clearing it: nothing sweeps an issue that
  is not a work item.

Label writes are always **granular** — add and remove named labels, never write
the label set. A set-write replaces from a stale snapshot and clobbers a
concurrent transition, and with a scheduler run and several executors moving labels at
once that is a correctness rule rather than a style preference.

## An item's identity is its issue number, and a hand-off carries a nonce

There is no slot id and no occurrence id beside the issue: **`#<n>` is the
occurrence**. It is what a `claudinite-task-exec` record's bracketed field
carries, and the only thing tying that record back to the work it describes.

A hand-off is an **API call**, not a label event — the executor invokes the
session directly and stamps a nonce on the item first. So a session proves it is
this item's session in code before acting: the task file exists at HEAD, its pack
is declared, the title names that task, the item carries `task:status:running-agent`, and the
newest hand-off comment carries the nonce it was given. A nonce mismatch means
the fire named a hand-off that is not the current one — the item belongs to
someone else, or to an earlier episode — and the session stops without labelling,
closing or running anything.

## Item lifecycle — every exit is terminal, and nothing keeps updating

- **Succeeded, nothing pending** → `task:status:done`, one comment, issue closed.
- **Parked for a human** → one `task:status:needs-human-*` label naming what is being
  asked for, one comment, issue left open. Nothing keeps updating a parked issue:
  one visible convergence, then it is a person's to look at. Re-queueing it by hand
  (`create-work-item --wake #<n>`) is the sanctioned road back: the wake stamps
  `Woken:`, so the cadence terms hold, and every other condition is re-evaluated
  at that pickup — which is what makes the retry safe even when the failed run
  half-did its work. The four:
  - `task:status:needs-human-approval` — succeeded, and deliberately left an unmerged PR
    for a person to merge or close. The only park that is not a fault. `--pr` names that
    PR, and any park may name what would end it: the item then closes by itself when
    the target resolves, `done` if it merged and `rejected` if it did not.
  - `task:status:needs-human-action` — something outside the code must change before this
    can run: a secret set, a scope granted, a routine rewired, an input supplied.
  - `task:status:needs-human-decision` — the run stopped mid-flight and the next step is a
    choice: re-queue or abandon, does the half-done work stand, was the ceiling
    violation acceptable.
  - `task:status:needs-human-failure` — the run broke. A bug, a contract-forbidden shape, a
    malformed item. The default when nothing else fits.

  **A parked item is not live, so no park holds the task's lane by itself**: the
  scheduler asks the task beside it. Whether a `failure` park stops the next
  occurrence is the task's own declaration, `last-run-not-failed`, with no default:
  declare it where a queue of items that will break the same way helps nobody and
  the silence is the signal; leave it out where the next run is what clears a
  transient fault. The other three parks are one person's inbox, not a fault in
  the task, and no term reads them.
- **Never ran** → `task:status:rejected`, closed as not planned: the precondition
  declined, or the task is gone (file removed, pack undeclared). An obsolete item
  is not an anomaly and gets no park. A scheduled task's next occurrence is the
  next tick's ask — and most declines never make an item at all: the scheduler
  run asks the preconditions at every tick, files an item only on a yes, and a no
  is a line in its log. A rejected item is still a run to `due:` (the period is
  consumed) but does not move the signal window: the next run sees what the
  rejected one saw.
- Every terminal state is recorded in code as a `claudinite-task-exec` line
  (`record-exec.mjs`), so the usage fold counts task statuses out of the captured
  conversation logs deterministically.

## A dormant scheduler runs nothing

A project nobody is working on stops its scheduler. It declares that on the pack that
owns the scheduler, not at the top level of `.claudinite-settings.json` — a repo
declaring no `claudinite-tasks` has no scheduler for the word to mean anything about:

```json
{ "id": "claudinite-tasks", "config": { "dormant": true } }
```

The scheduler run asks, readies and reclaims nothing, and the executor picks nothing up;
sessions are unaffected. Delete it to wake — a dormant spell is not replayed, so the repo
simply starts scheduling again from now.

What it does **not** cover matters as much: the repo stays a member, its mount is still
measured against canon, and one that has fallen behind is still reported as behind. A
stopped scheduler buys quiet about the scheduler, and nothing else.
