# Growth — extract lessons (per repo)

The growth lifecycle's capture stage, over **both** lesson sources in one run: the window's repo activity
(commits, merged PRs, issue discussion) and the conversation logs captured from working sessions. Each
durable, reusable lesson is folded into the repo's own **local packs** (`.claudinite/local/packs/` — the
normalized capture surface) at the repo's own level, without straining to generalize it. The run lands its
edits through a PR that **auto-merges once the repo's checks pass** (no human review — daily capture never
piles up as review requests); finding nothing to add on a given run is a perfectly good outcome.

You run under the executor, dispatched by a `ready-for-agent` issue whose **Context section is binding
scope**: it names which halves are live, the substantive commit shas and the PRs/issues touched in the
window, and whether the retention prune is due. That is the work; do not widen it.

> This is the **unattended daily** capture. It writes only the repo's *own* local packs, so — **unlike** an
> owner-requested, in-session retrospective (which delivers a PR for a human to review) — it opens a PR and
> **arms auto-merge**: GitHub lands it once the repo's checks pass. The shared canon stays human-gated —
> lifting anything up into it is the central promote task's job (canon-side), and that PR waits for the owner.

## Conventions used in this doc

- **Default branch.** `main` stands for **this repository's default branch** — substitute whatever the repo uses.
- **Access split — local git for repo content, MCP for the issue/PR API.** The repo's own content is plain
  **local git** in the checkout: the commits, the `conversation-logs` branch and its files
  (`git fetch`/`show`/`rm`/`push`), and staging the lesson edits onto a branch. Reading issue/PR activity,
  opening the PR and arming its auto-merge, posting the exchange summaries and the tracking-issue log go
  through the session's **GitHub MCP tools** (`mcp__github__*`). The unattended run has no shell GitHub
  access — the shell reaches only a git-over-HTTPS proxy scoped to one repo, with no REST credential — so
  never reach for `gh`/`curl` or a cross-repo clone.
- **The repo's local packs.** The set identified in
  [this pack's README](../../README.md#identifying-a-projects-capture-surface-its-local-packs) — everything
  under `.claudinite/local/packs/` (the legacy `.claudinite/local_packs/` accepted during the rename
  window), the repo's own packs; never the read-only mounted canon elsewhere under `.claudinite/`.

## The run — two source skills, then the upgrade pass

The **method** for each source lives in its skill; this worker only frames the run around them. Don't
re-derive any of it here.

1. **Activity half — the [extract-from-activity](../../skills/extract-from-activity/SKILL.md) skill**, over
   exactly the commits, merged PRs and issues named in Context. **Skip this half entirely when Context says
   the activity half is not in scope** (a quiet repo whose only reason to run was the retention prune).
2. **Conversation half — the [extract-from-conversations](../../skills/extract-from-conversations/SKILL.md)
   skill**, over the repo's captured logs. `git fetch origin conversation-logs`, then list its files
   (`git ls-tree --name-only origin/conversation-logs`); no branch, or no `*.jsonl`, and this half is done.
   Give each log captured in the recent window a **fresh pass** (its filename carries the capture stamp;
   corpus dedup makes an overlapping re-read harmless, so err toward re-reading the last several days), and
   post the skill's provenance summary for each rule that actually lands.
3. **Retention prune**, when Context says it is due. Read `retention_days` from this repo's
   `.claudinite-checks.json` (the grow_with_claudinite entry's `config.retention_days`) — unset means this
   step is skipped entirely (capture-only adoption). For each log whose filename stamp is older than
   `retention_days` days: give it the **final hindsight pass** the skill describes (anything it still yields
   lands like any other keeper), then `git rm` it on the `conversation-logs` branch and push (commit message
   ending `[skip ci]`). The branch is never merged and its history is never rewritten — plain add/remove
   commits only. This push to the non-default logs branch is outside the outcome taxonomy (DESIGN §1).
4. **Upgrade pass — the [prose-to-checks](../../skills/prose-to-checks/SKILL.md) skill, over what *this run*
   just wrote.** Both halves route down the local promotion ladder as they go, but a lesson written as prose
   under time pressure is exactly where a convertible rule hides. So before opening the PR, take the prose
   this run added and ask the skill's questions of it: does it clear the working-rule gate, and does it
   constrain a static signature a check could observe? If yes, convert it now — author the rule module,
   register it in its pack's `pack.mjs`, prove it with a **see-it-fail** fixture, and apply the deletion
   test to the prose the check now stands beside. **Scope is this run's own additions only** — the standing
   prose backlog is the weekly [prose-to-checks-sweep](../prose-to-checks-sweep/task.md)'s job, and widening
   into it here would duplicate that task's work under an auto-merging PR.

If an edit touches something a test reads (a doc constant, a code path), run the repo's offline test suite
and keep it green before opening the PR.

## Output: one PR that auto-merges after CI

If the run found at least one genuinely new lesson, it lands **all** of it — both halves, plus any check the
upgrade pass produced — through a **single auto-merging PR**: one commit for the whole run on a
per-run-unique branch, not one per lesson and not one per half. Open the PR (title
`Claudinite growth: extract lessons`, its commit referencing the tracking issue so the `task-lifecycle` gate
passes) and **arm auto-merge**: GitHub squash-merges it once the repo's checks pass — no human review, so
daily lesson-capture never floods review requests, while every change still gets a PR trail and a CI gate.
Where the repo has no CI, GitHub lands it as soon as it's mergeable. This writes only the repo's *own* local
packs (not the shared canon). A run that finds nothing and opens nothing is fine — and common.

A new check must ship green — see it fail on a violating fixture, pass on a clean one — so CI stays green and
the PR can merge; a check that can't be made confident lands its lesson as prose instead, never a broken check.

## Tracking: log each run under the task's own issue

The task's standing log is the issue titled exactly, in this repo:

> **Claudinite tracker: Growth Extract**

Find it **by that exact title, never a fuzzy match or a hard-coded number** (a bare number can dangle, and it
differs per repo). A run that finds no issue under the exact title just creates one (closed). **Never open,
close, or reopen it** afterward — its state carries no meaning, only the log does. When a run adds a lesson,
converts one to a check, or prunes logs, log it as a **dated comment** — not a sub-issue — so the issue
accumulates a scrollable history, each entry naming **what happened and where**. A run that changed nothing
logs nothing. (A repo that still carries a closed `Claudinite tracker: Conversation Extract` issue from when
the halves were two tasks keeps it as history — never post to it, never reopen it.)

## Run on a capable model

Deciding whether a lesson is genuinely new and durable — and deduping it against what's already documented —
is a **judgment call**, not mechanical extraction. A downgraded model adds noise or restates what's there,
and **auto-merge means no human reviews the PR before it lands** — CI gates correctness, not whether a
"lesson" earns its keep — so the capable-model requirement matters all the more. This task declares
`agent_model: opus`; the executor dispatches its subagent there.

## What this task must never do

- **Never touch the shared canon** — this task writes only the repo's *own* local packs under
  `.claudinite/local/packs/`; everything else under `.claudinite/` is the read-only mount, and lifting a
  lesson up into the canon is the central promote task's job.
- **Never widen past the Context window** — the halves it declares live, the substantive commits and the
  touched PRs/issues named there are the scope; do not re-decide it. That includes the upgrade pass: this
  run's own additions, never the standing backlog.
- **Never merge `conversation-logs`** anywhere, and never rewrite its history — plain add and remove commits only.
- **Never paste the conversation onto an issue** — not raw JSONL, not a rendered transcript, not the turns
  themselves. Each landed rule gets one ≤200-word summary of the exchange behind it, and nothing more.
- **Never delete a log younger than retention, and never delete anything while `retention_days` is unset** —
  deletion is the ack that both passes happened.
- **Don't add noise** — a duplicate or hallucinated "lesson" is worse than adding nothing, the more so when
  its PR auto-merges with no human review to catch it.
