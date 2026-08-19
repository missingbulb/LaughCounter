# Growth — dedup local packs against the canon (per repo)

The growth lifecycle's pruning stage: reconcile this repo's **local packs** against the shared **canon** it
consumes (Claudinite, vendored read-only), pruning local items — a pack's prose line, or a whole local check —
the canon now covers. It lands the run's prunes through a single PR against the repo's default branch,
**delivered to land** per the repo's own delivery settings. Often there's nothing to prune, and that's fine. You run from a work item the executor handed off, whose
**Context** is **binding scope — not a hint** (the executor will not let you re-decide or widen it).

> This task only prunes local packs against the canon; lifting local items up into the canon is the central
> promote task's job (canon-side).

## Conventions used in this doc

- **Default branch.** `main` stands for **this repository's default branch** — substitute whatever the repo uses.
- **GitHub access is MCP-native.** Updating the tracking issue and opening the PR go through the session's
  **GitHub MCP tools** (`mcp__github__*`). The unattended run has no shell GitHub access — the shell reaches
  only a git-over-HTTPS proxy scoped to one repo, with no REST credential — so never reach for `gh`/`curl` or
  a cross-repo clone.
- **The mounted canon.** The exact canon revision this repo currently consumes — compare against *that*, not a
  live fetch. It is what `.claudinite/shared/` holds at the mount's stamp (a promotion is visible here only
  once baselining has converged the mount to include it). Prune only against what the repo actually mounts.
- **The dispatch's Context narrows the *yardstick*, never the local surface.** When the Context names
  newly-changed canon packs ("Re-check local items against these newly-changed canon packs: …"), **those packs
  are this run's entire yardstick**: every prune must cite a line or rule id from one of *them*, and you never
  widen the comparison to the rest of the mounted canon. What is *not* narrowed is the local side — **every**
  local item is in play against those packs, whatever it is about. (Local pack names are unrelated to canon
  pack names, so there is nothing to match up.) A dispatch with **no** Context block carries no such bound: the
  precondition emits the list only when the mounted canon moved, and its other arm — the repo's own local packs
  changed — deliberately emits none, so that run compares the fresh local items against the whole mounted canon.
- **The repo's local packs.** The set identified in [this pack's README](../../README.md#identifying-a-projects-capture-surface-its-local-packs) —
  everything under `.claudinite/local/packs/` (the legacy `.claudinite/local_packs/` accepted during the
  rename window). That's the corpus this task prunes within; the read-only mounted canon elsewhere under
  `.claudinite/` is never a prune target, only the yardstick you prune *against*.

## Start by reading the canon window diff

**Prework already ran** — [worker.mjs](worker.mjs), the deterministic first phase of this task — and wrote
what the mounted canon **added** in this window into the tracking issue's body: per declared pack, the added
prose lines file by file, and the ids of any checks the window introduced. Your dispatch names that issue.
**Read it before opening a single local pack.**

That brief is the run's *starting point*, not a second bound: the Context's pack list is still what a prune
may cite, so a local item covered by an older line in one of those packs is a legitimate prune when you can
quote that line. What the brief buys you is attention spent where the *new* coverage is, instead of re-reading
a corpus whose lines mostly predate this run. It is complete except where it says otherwise — a file whose
diff was too large to fetch, and a per-file line cap, are both stated in place with the remainder counted; go
read those files directly.

A window in which no declared canon pack moved says so, and that run compares the repo's fresh local items
against the mounted canon as a whole — the same as a dispatch with no Context block.

The [skill](../../skills/growth-dedup/SKILL.md) owns what to do with the additions: which are candidates,
which prune nothing, and why a removed canon line is the reverse signal.

## The method lives in the skill

What to prune, strip, or rephrase; the keep-test (an item that says *more* than the canon stays; one that
only says it in repo-specific names goes); how a canon **check** covers an item more strongly than prose;
and the shrink-only discipline — all of that is owned by the
[**growth-dedup** skill](../../skills/growth-dedup/SKILL.md). Follow it; don't re-derive it here. This
worker only frames the unattended run around it.

## Discipline

- **Only remove a local item you can show the mounted canon genuinely covers — quote the canon line (or the
  covering check's rule id).** When unsure, leave it; a wrongful prune deletes a real local lesson.
- **Open a single PR against `main`** from a per-run-unique branch (see
  [the git-github-advanced skill](../../../git-github/skills/git-github-advanced/SKILL.md)) — one PR for the
  whole run's prunes, not one per item — never a direct push. **Title the commit and the PR
  `Claudinite growth: dedup local packs`** — the `growth-write-scope` check keys on that title to certify the
  run pruned only the repo's local packs. Then **deliver it by the shared procedure —
  [deliver-pr.md](../../../../engine/scheduler/deliver-pr.md)**. That procedure — never this file — owns every
  landing nuance: it reads this repo's `maintenance.delivery` (a `review` repo's PR waits for the owner — still
  a delivered outcome) and arms auto-merge where the repo allows it. Do not assume this run's PR merges
  unreviewed — that is the repo's setting, not this task's (the declared ceiling is `merged-pr`: it *may*
  land). What holds the prune bar on the default settings is the quote-the-canon-line discipline above, the
  `dedup-prune-integrity` and `growth-write-scope` checks, and CI — never a reviewer's second look, which a
  wrongful prune is easy to wave through anyway. **Put the issue reference in the commit message** —
  `Refs #<n>` for this task's tracking issue (below), in the commit itself, not only the PR body. The repo's
  `basics` `task-lifecycle` check gates a PR on its commits referencing an issue, so a prune commit that cites
  none reds the repo's CI and blocks the merge.
- If an edit touches something a test reads, run the repo's offline test suite and keep it green before pushing.

## Tracking

The task's standing log is the issue the work item's **Delivered by prework** section names (`Issue: #<n>`).
Prework found or opened it and has already rewritten its body with this run's brief.

**That number is a required input.** A work item that does not carry it is a failed run, not a lighter one: converge to `needs-human` naming the missing input.
Never search for a tracker by title and never create one — the brief
you are working from lives on a specific issue, and any issue you find yourself is a different one. Never
re-write the body prework just wrote, and **never open, close, or reopen it**: its state carries no meaning,
only the log does.

Its **body** is prework's, rewritten every run: this window's canon diff, the brief you started from. Leave it
alone. The **comments** are yours: log each run that changed a doc as a **dated comment** — naming what was
pruned and the canon line that now covers it. A run that prunes nothing logs nothing.

## Run on a capable model

Proving the mounted canon genuinely covers a local item before pruning it — and telling "the canon now owns
this" from "the canon states this too generally, keep the local cut" — is a **judgment call**. A downgraded
model prunes a real lesson, and on the default delivery settings the PR carrying it lands once CI passes —
there is no reviewer downstream to catch what the run got wrong. This task declares `agent_model: opus`; the executor dispatches its subagent there.

## What this task must never do

- **Never edit the read-only canon** — it only prunes the repo's *local packs* against it, and the
  `growth-write-scope` check reds a run that touches anything outside them.
- **Never land a prune outside a PR** — every prune rides the run's single PR, delivered by
  [deliver-pr.md](../../../../engine/scheduler/deliver-pr.md); a direct push to `main` is never in scope, and
  neither is merging past a red check or a repo whose delivery setting says `review`.
- **Never prune a local item without quoting the mounted-canon line (or covering check rule id) that covers
  it** — when unsure, leave it.
- **Never widen the dispatch's Context.** If it named the changed canon packs, a prune citing coverage from
  any *other* canon pack is out of scope for this run — leave the item; the cycle that moves that pack will
  reach it.
- **Never prune a local item that makes a stronger point about a narrower case** than the canon — that isn't
  redundancy. (A local item that only restates the canon in repo-specific names *is* prunable once the canon
  covers the point.)
- **Never let a dedup edit grow an entry or re-import canon prose** — every action removes portable text;
  the skill owns the strip discipline, and the `dedup-prune-integrity` check (this pack) is the backstop
  that reds the session when a dedup-labeled commit grows a local-pack prose file or restates a canon rule.
