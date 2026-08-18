# core

Claudinite's own surface in a repo that runs it: the vendored mount, the declaration that activates a
pack, adopting Claudinite and adopting a pack, and the contract every scheduled task is written to.

**Mandatory.** `basics` `requires` this pack, so the closure vendors its content and materializes its
declaration wherever a declaration is written; the one-time `core-seed` migration record declares it
into members that already exist. Removing the entry is not an opt-out — it is drift, and `core-declared`
reports it.

## Rules (`RULES.md`)

| Rule | Severity | Reason | Enforcement |
|---|---|---|---|
| Reading a rule that arrived from Claudinite | high | correctness | prose: 43 words + check (`claudinite-isolation`) |
| Finding a mounted skill's real path | medium | complexity | prose: 81 words |
| Wanting a pack's rules to apply here | high | correctness | prose: 47 words + check (`core-declared`) |
| Adding a pack | medium | complexity | prose: 27 words |
| Setting a project up on Claudinite | medium | complexity | prose: 15 words |
| Deciding which pack owns a lesson | medium | complexity | prose: 59 words |
| Judging whether Claudinite is current here | medium | correctness | prose: 43 words |
| Writing or changing a scheduled task | high | correctness | prose: 26 words + checks (`task-declaration-shape`, `task-declaration-matches-folder`) |
| Answering "why did the mount not update" | medium | correctness | prose: 39 words |

## Checks

Each of these asks the same kind of question: **is Claudinite working in this repo** — declared,
converged, gated, scheduled. A repo can fail any of them silently, which is why they are checks and
not prose: the session that has lost its rules is the session least able to notice.

| Check | Severity | Reason | Enforcement |
|---|---|---|---|
| `core-declared` | critical | correctness | check: blocking |
| `rules-index-current` | critical | correctness | check: blocking |
| `claudinite-isolation` | high | complexity | check: blocking |
| `conformance-workflow` | high | correctness | check: advisory |
| `scheduler-workflow-shape` | high | correctness | check: blocking |
| `task-declaration-shape` | high | correctness | check: blocking |
| `task-declaration-matches-folder` | high | correctness | check: blocking |
| `task-phase-discipline` | medium | complexity | check: advisory |

What goes wrong when one fires:

- `core-declared` — this pack's entry is gone from `.claudinite-checks.json`, so none of the rules above run and the session cannot tell.
- `rules-index-current` — the generated index is missing, stale or unimported: the repo's packs contribute no prose to any session.
- `claudinite-isolation` — the repo's own code reaches into `.claudinite/`, so the next canon refactor is a breaking migration for code the canon does not own (a declared `forbidReferences` [barrier](../barriers/README.md) edge).
- `conformance-workflow` — nothing in CI runs the world sweep unfiltered on a pull request, so conformance is ungated and the maintenance PR never lands.
- `scheduler-workflow-shape` — the vendored scheduler's cron, concurrency or dispatch guard has drifted: staggering, double-run safety or manual runs break.
- `task-declaration-shape` — a task declaration the scheduler reads is incomplete or illegal, so the task never fires or fires wrong.
- `task-declaration-matches-folder` — a declaration disagrees with its folder: discovery drops it into `errors` and every run keeps reporting healthy without it.
- `task-phase-discipline` — a task decides not to run after its precondition already said run, hiding the decision from the run records.

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

The adoption skills bundle two more checks of the same kind, over the answers a member stores
against each declared pack's questions:

| Check | Severity | Reason | Enforcement |
|---|---|---|---|
| `adoption-answers-pending` | medium | complexity | check: blocking |
| `interview-answer-stale` | low | complexity | check: advisory |

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
