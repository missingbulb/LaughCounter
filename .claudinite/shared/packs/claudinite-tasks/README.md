# claudinite-tasks — scheduled work

Everything whose subject is task work: the work-item queue, the executor, the task contract and
its signals, calendar/anchor math, run records, code-work, and the delivery lane a task's output
lands through. Declaring this pack is what gives a repo scheduled work; a repo that does not
declare it runs none, which is a supported state rather than a degraded one.

The mechanism itself — the state machine, the generator, the executor's protocol, urgency and
forcing, recovery — is the canon's own tasks-dispatch design document, and authoring a task is the
`writing-tasks` skill's subject. This file is the pack's own map.

## Layout

| Path | What lives there |
|---|---|
| `queue/` | the work item and its vocabulary, the scheduler run, the executor and its continuation, the drain, leases, readiness, the janitor's rules, the schedule board, workflow-failure escalation |
| `queue/tasks/` | the built-in tasks (`implement-request`) |
| `signals/` | the signal collectors a precondition is handed |
| `stubs/` | the two workflow files an adopting repo receives |
| `shared-code/` | the published import surface — see below |
| `tasks/` | this pack's own scheduled tasks: `task-janitor` (the queue's sweeps) and `usage-fold` (it folds this mechanism's run records and outcome labels) |
| `worldRules/` | the task-declaration checks |
| `workRules/` | the armed-auto-merge gate (`automerge-policy-scope`) |
| `merge-policy.mjs` | the auto-merge policy engine: what a task's `automerge`, an item's `Merge:` field and the arming trailer mean, the built-in diff classes, the inline `under:<dir>` folder scope, the `&&` intersection, and the `merge-rules.json` vocabulary a pack extends them with |
| `test/` | the unit suite, and `test/sim/` — the simulator and its scenario suite, the mechanism's executable spec |
| `executor.md`, `queue/instructions.md`, `deliver-pr.md` | operational documents a member's routines and workers read out of their own mount at runtime |

## `shared-code/` — the one sanctioned cross-pack import

Another pack's code may import `packs/claudinite-tasks/shared-code/*`, and nothing else of this
pack. The `pack-independence` barrier's allow list names that directory; no other pack gains an
equivalent surface by existing.

| Module | What it publishes | Who reads it |
|---|---|---|
| `work-items.mjs` | the title grammar that is a work item's identity, the outcome/status decode over its labels, lease state, the dispatch vocabulary, and what a scheduler run would instantiate | claudinite-dashboard, claudinite-fleet-sheepdog |
| `anchors.mjs` | period length, and the instant a task's window last opened at or opens next | claudinite-dashboard |
| `delivery.mjs` | `landPr`, `deliverGenerated` — how a task's output becomes a landed PR or a regenerated file | any pack whose tasks deliver |
| `github.mjs` | the GitHub client and REST helpers, and the tracker issue a worker records on | any pack whose tasks reach GitHub |
| `signals.mjs` | the signal shapes a precondition is handed | packs asserting what their own tasks will see |
| `task-contract.mjs` | task-declaration validation, and precondition evaluation as the executor does it | every pack with tasks, in its own tests |
| `merge-policy.mjs` | the auto-merge policy verdict (`automerge`, the `Merge:` field, the arming trailer) and the `merge-rules.json` compiler | any pack declaring policies or merge rules, in its own tests |
| `usage-format.mjs` | the usage aggregate's codec | claudinite-fleet-sheepdog's fleet-wide aggregator |

A pack whose **non-task** code reads any of these declares `requires: ['claudinite-tasks']`. A
pack's `tasks/` folder needs no declaration: a mount without this pack carries no `tasks/` at all,
since a task folder is inert without the queue that runs it.

## Adoption

The two workflow files and the routine endpoints cannot converge into place — `.github/workflows/`
is the one directory a member's nightly update may never write — so they are scaffolded once, at
adoption, by the `adopt-pack` skill. They are static from then on: the per-repo cron minute and
anchor hours are written once, secrets travel as one fixed line, and the `run:` lines name mount
pack paths behind which everything converges nightly.

## The legacy `engine/scheduler/` shims

Until #1317's execution chain finishes, `engine/scheduler/*` still exists as one-line re-exports of
this pack, for members whose vendored workers, workflow `run:` lines and stored routine prompts
still name the old paths. They ship only into a mount that carries this pack, and they are deleted
once no fielded member names one.

## Checks

| Rule | Confidence | Dimension | Enforcement |
|---|---|---|---|
| `task-declaration-shape` | high | correctness | check: blocking |
| `task-code-work-env` | high | correctness | check: blocking |
| `automerge-policy-scope` | high | correctness | check: blocking |

The first two are relevance-first — inert until the repo carries a `tasks/<name>/task.mjs` of its own; the third is self-gating on the branch's own arming trailer.

- `task-declaration-shape` — a task declaration the scheduler reads is incomplete or illegal, so the task never fires or fires wrong.
- `task-code-work-env` — a task reads a `CLAUDINITE_*` variable code-work never sets, so a parameter (a scope filter, a dry-run switch) silently never arrives and the run goes green in its most dangerous mode.
- `automerge-policy-scope` — a branch that stamped the `Claudinite-Automerge-Policy` trailer (its run intends to land its own PR) carries a diff its declared policy does not cover, which is exactly the unreviewed change the policy exists to stop.
