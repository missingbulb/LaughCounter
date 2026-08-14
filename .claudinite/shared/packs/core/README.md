# core

Claudinite's own surface in a repo that runs it: the vendored mount, the declaration that activates a
pack, adopting Claudinite and adopting a pack, and the contract every scheduled task is written to.

**Mandatory.** `basics` `requires` this pack, so the closure vendors its content and materializes its
declaration wherever a declaration is written; the one-time `core-seed` migration record declares it
into members that already exist. Removing the entry is not an opt-out — it is drift, and `core-declared`
reports it.

## Checks

Each of these asks the same kind of question: **is Claudinite working in this repo** — declared,
converged, gated, scheduled. A repo can fail any of them silently, which is why they are checks and
not prose: the session that has lost its rules is the session least able to notice.

| Rule | Severity | What goes wrong when it fires |
|---|---|---|
| `core-declared` | blocking | this pack's entry is gone from `.claudinite-checks.json`, so none of the rules below run and the session cannot tell |
| `rules-index-current` | blocking | the generated index is missing, stale or unimported — the repo's packs contribute no prose to any session |
| `claudinite-isolation` | blocking | the repo's own code reaches into `.claudinite/`, so the next canon refactor is a breaking migration for code the canon does not own (a declared `forbidReferences` [barrier](../barriers/README.md) edge) |
| `conformance-workflow` | advisory | nothing in CI runs the world sweep unfiltered on a pull request, so conformance is ungated and the maintenance PR never lands |
| `scheduler-workflow-shape` | blocking | the vendored scheduler's cron, concurrency or dispatch guard has drifted — staggering, double-run safety or manual runs break |
| `task-declaration-shape` | blocking | a task declaration the scheduler reads is incomplete or illegal, so the task never fires or fires wrong |
| `task-declaration-matches-folder` | blocking | a declaration disagrees with its folder — discovery drops it into `errors` and every run keeps reporting healthy without it |
| `task-phase-discipline` | advisory | a task decides not to run after its precondition already said run, hiding the decision from the run records |

The scope cuts the other way too: a rule about how the **canon's own** content is maintained is not
this pack's, however much it looks like one. `catalog-completeness` — `packs/README.md` lists every
`packs/<name>/` — reads as Claudinite machinery and is not: it can only fire in the corpus repo, and
what it guards is a hand-maintained index, not a member's status. It stays in
[basics](../basics/README.md) with the other doc-integrity rules.

## Skills

| Skill | For |
|---|---|
| [`adopt-claudinite`](skills/adopt-claudinite/SKILL.md) | setting a project up on Claudinite for the first time — mount, hooks, checks, skills — and re-baselining one to pick up updates |
| [`adopt-pack`](skills/adopt-pack/SKILL.md) | adding a pack to a repo that already runs Claudinite: declare, interview, re-vendor, scaffold, land |

`adopt-claudinite` bundles two more checks of the same kind — `adoption-answers-pending` and
`interview-answer-stale`, over the answers a member stores against each declared pack's questions.

## Tasks

| Task | frequency | Runs when |
|---|---|---|
| `update` | daily (02:00 slot) | the mount is behind the canon, or a declared pack moved |
| `adopt-requested-packs` | daily | the repo carries an open pack-adoption request |

`update` is the per-repo self-refresh — the task that converges a member's mount and stamps it. It
is why `core-declared` is blocking: a member runs `update` from its **vendored** copy, and
`discoverTasks` finds only a literally-declared pack's tasks, so a repo that loses this pack's entry
loses its self-refresh, and nothing is left that could deliver it one. That is also why the task
arrived here a change later than the rest of the pack — it moved only once every non-dormant member's
declaration had been read back and confirmed to carry `core`.
