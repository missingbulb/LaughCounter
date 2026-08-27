# tidy-repo

The repo tidy-up as a composable pack: the nightly PR/issue sweep and the weekly comment pass,
contributed to the fleet
maintenance plan the same way any pack contributes checks and skills. Declaring `tidy-repo` enrolls a
repo in the sweep; removing it is a durable opt-out (baselining never re-adds it).

**Declared pack** — no fingerprint. `bootstrap --init` seeds it into every new repo, and the one-time
`tidy-repo-seed` baseline migration seeds the existing fleet. Carries no *conformance* checks — its
work is maintenance tasks — but its `improve-comments` skill owns the one gate that makes that task's
unattended write to a repo's source safe.

**No `RULES.md`.** The pack's policy — assess PRs read-only, act only on issues, change nothing but
comments in the source — is what its three *workers* do, and each one states it in the `task.md` it
loads at run time. Restating it as prose would charge every session in every declaring repo for a
description of three unattended runs it is not part of. What that policy is, for a human reading
about the pack, is this file's job, below.

## Maintenance tasks

One task per dimension. Each is triggered by the only thing that changes its answers, scoped to
exactly those objects, and reconciles **its own** standing tracker — so no task waits on another and
a dimension with nothing to do stays silent:

| Task | frequency | Runs when | Scope | Acts? | model |
|---|---|---|---|---|---|
| `tidy-issues` | daily | an issue was touched in the window | the touched issues — **all** open ones when `main` also moved substantively | **yes** — close / label / comment | `sonnet` |
| `tidy-prs` | weekly | an open PR was opened or updated in the window | every open PR (a full sweep) | no — recommends closes | `sonnet` |
| `improve-comments` | weekly | a substantive commit landed in the window, and this pass's previous PR has been reviewed | the files those commits touched (capped, the rest next round) | **yes** — edits comments in the source, in a PR left for review | `opus` |

The two GitHub-object tasks apply their per-object skill (`single-issue-triage` / `single-pr-status`)
across the targets the precondition hands them, then rewrite their tracker (`Claudinite tracker: Tidy Issues` / `Tidy PRs`) from
those verdicts — but only when the run has something to record: an action taken, or a picture that
differs from the body's. A run whose verdicts match what the tracker already says writes nothing at
all.

`improve-comments` has no tracker: its output is a PR, and a standing issue restating what the PR
already shows would be a second place to read the same thing.

**Nothing new, no run.** Every dimension is gated on *its own* objects moving in the window: no issue
touched, no `tidy-issues`; no open PR opened or updated, no `tidy-prs`; nothing committed, no
`improve-comments`. The verdicts over an unmoved
set are the ones already in the tracker, so a re-run rewrites the body with itself and spends an agent
to do it. What does **not** count as movement: a `main` that advanced (that widens an already-triggered
issue run, but never wakes one — on an active repo it is true most days), and a PR that merged. Nor can
`tidy-issues` be its own movement: `single-issue-triage` posts nothing when the verdict is the
one it already posted there, so a standing verdict never re-arms tomorrow's run. Nor is the scheduler's
own queue: an issue wearing a `task:*` label is a work item, not project work, and `tidy-issues` drops
it from both the trigger and the scope — the signal's own filter goes by title, which a queue item filed
under any other title escapes.

**Where the "full run" lives.** Scope is never narrowed to the movers, because a verdict is relative to
the rest — superseded-by, already-in-`main`, implemented-by-a-commit all need the others in view. So
newness is the **gate** and the full set is the **scope**. For issues the widening to every open issue
is signal-triggered on a substantive default-branch move, because that move is what can make an old
issue implemented. For PRs "full" is the **frequency declaration** — weekly, and full whenever it
runs. Never a `fullSweep` flag inside a daily task: weekly is a declaration, not a gate trick
(per-project-scheduling DESIGN §3).

## Checks

| Check | Severity | Reason | Enforcement |
|---|---|---|---|
| `improve-comments-scope` | high | correctness | check: blocking |

Owned by the `improve-comments` skill
([checks.mjs](skills/improve-comments/checks.mjs)), because it validates that skill's action rather
than a property of the repo: on a branch whose commit subject is `Claudinite tidy: improve comments`
it strips the comments from both sides of every changed file and reds anything left over. Silent
everywhere else, so a repo declaring this pack pays nothing for it on an ordinary branch.
