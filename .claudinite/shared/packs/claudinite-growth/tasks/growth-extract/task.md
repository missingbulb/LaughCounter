# Growth — extract lessons (per repo)

The growth lifecycle's capture stage, over **both** lesson sources in one run: the window's repo activity
(commits, merged PRs, issue discussion) and the conversation logs captured from working sessions. Each
durable, reusable lesson is folded into the repo's own **local packs** (`.claudinite/local/packs/` — the
normalized capture surface) at the repo's own level, without straining to generalize it. The run lands its
edits through a single PR, handed to the shared delivery procedure; finding nothing to add
on a given run is a perfectly good outcome.

The run's **Context section is binding scope**: it names the substantive commit shas and the
PRs/issues touched in the window. That is the work; do not widen it.

> This is the **unattended daily** capture. It writes only the repo's *own* local packs, so — **unlike** an
> owner-requested, in-session retrospective — it opens a PR and hands it to the shared delivery
> procedure (*Output* below). The shared canon stays human-gated — lifting anything up into it is the
> central promote task's job (canon-side), and that PR waits for the owner.

## Conventions used in this doc

- **Default branch.** `main` stands for **this repository's default branch** — substitute whatever the repo uses.
- **Access split — local git for repo content, MCP for the issue/PR API.** The repo's own content is plain
  **local git** in the checkout: the commits, the `conversation-logs` branch and its files
  (`git fetch`/`show` — read-only), and staging the lesson edits onto a branch. Reading issue/PR activity,
  opening the PR and delivering it, posting the exchange summaries and the tracking-issue log go
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
   exactly the commits, merged PRs and issues named in Context.
2. **Conversation half — the [extract-from-conversations](../../skills/extract-from-conversations/SKILL.md)
   skill**, over the repo's captured logs. `git fetch origin conversation-logs`, then list its files
   (`git ls-tree --name-only origin/conversation-logs`); no branch, or no `*.jsonl`, and this half is done.
   The skill owns **which** logs a run reads; read exactly that set, and post the skill's provenance
   summary for each rule that actually lands.
3. **Upgrade pass — the [prose-to-checks](../../skills/prose-to-checks/SKILL.md) skill, over what *this run*
   just wrote.** Both halves route down the local promotion ladder as they go, but a lesson written as prose
   under time pressure is exactly where a convertible rule hides. So before opening the PR, take the prose
   this run added and ask the skill's questions of it: does it clear the working-rule gate, and does it
   constrain a static signature a check could observe? If yes, convert it now — as a declaration in its
   pack's `declared-checks.json`, dropping to a rule module registered in `pack.mjs` only where patterns
   can't say it — prove it with a **see-it-fail** fixture, and apply the deletion test to the prose the
   check now stands beside. **Scope is this run's own additions only** — the standing
   prose backlog is the weekly [prose-to-checks-sweep](../prose-to-checks-sweep/task.md)'s job, and widening
   into it here would duplicate that task's work under an auto-merging PR.

If an edit touches something a test reads (a doc constant, a code path), run the repo's offline test suite
and keep it green before opening the PR.

## Output: one PR

If the run found at least one genuinely new lesson, it lands **all** of it — both halves, plus any check the
upgrade pass produced — through a **single PR**: one commit for the whole run on a per-run-unique branch, not
one per lesson and not one per half. Open the PR (title `Claudinite growth: extract lessons`, its commit
referencing the tracking issue so the `task-lifecycle` gate passes), then **deliver it by the shared
procedure — [deliver-pr.md](../../../../packs/claudinite-tasks/deliver-pr.md)** — that procedure, never this
file, owns whether and how the PR lands. This writes only the repo's *own* local
packs (not the shared canon). A run that finds nothing and opens nothing is fine — and common.

A new check ships with its **red-first fixture** — see it fail on a violating fixture, pass on a clean one —
and with `since: '<today>'`, which holds a `blocking` check to advisory for its first two weeks. That window
is what lets this run land a check the tree *does* violate: the backlog it surfaces belongs to whoever
touches those files next, not to this PR, and CI stays green either way. Never ship a check you can't make
confident — but "the tree still violates it" is no longer a reason to drop to prose.

## The PR is the record

There is no changelog file to update and no standing tracker issue to comment on: this run's commit and
its PR body are what say what landed and why. Say it there — the rule added, the check it became, the
evidence behind it — so a reader who blames a rule back to its commit finds the reasoning already written.

## Nothing downstream catches a bad lesson

Deciding whether a lesson is genuinely new and durable — and deduping it against what's already documented —
is a **judgment call**, not mechanical extraction. Restating what the corpus already says, or promoting a
one-off into a rule, is the characteristic failure. **On the default delivery no human reviews the PR before
it lands** — CI gates correctness, not whether a "lesson" earns its keep — so this run is the only judgment
in the loop.

## What this task must never do

- **Never write outside the repo's own local packs** — this task improves the repo's **packs**, never the
  canon, never the project's own code, and never its comments, which belong to the tidy-repo pack's
  `improve-comments` task. Everything else under `.claudinite/` is the read-only mount, and lifting a lesson
  up into the canon is the central promote task's job. A lesson tied to one call site is dropped, not landed
  as its pack's entry naming the site. The `growth-write-scope` check keys on this run's pinned title
  (below) and reds any path outside the local packs.
- **Never widen past the Context window** — the halves it declares live, the substantive commits and the
  touched PRs/issues named there are the scope; do not re-decide it. That includes the upgrade pass: this
  run's own additions, never the standing backlog.
- **Never paste the conversation onto an issue** — not raw JSONL, not a rendered transcript, not the turns
  themselves. Each landed rule gets one ≤200-word summary of the exchange behind it, and nothing more.
- **Never write to the `conversation-logs` branch at all** — reading it is this run's whole business with
  it. Retention is the agentless `logs-prune` task's job, on the capture stamps alone.
- **Don't add noise** — a duplicate or hallucinated "lesson" is worse than adding nothing, the more so when
  its PR usually lands with no human review to catch it.
- **Never spend the prose ration to avoid the work of a higher rung.** The ladder rations prose at **at most
  two** new `RULES.md` rules per run, each one sentence. A run with something real to say says it as a
  check; a paragraph of prose standing in for a check nobody wrote is this task's characteristic failure,
  and it is charged to every session in every repo that declares the pack, forever.
