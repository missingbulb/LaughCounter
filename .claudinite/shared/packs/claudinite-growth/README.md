# claudinite-growth

Opt into the **growth lifecycle** — declaring this pack enrolls a repo in contributing its hard-won
lessons up to the shared Claudinite canon, and in pruning its local packs once the canon owns them.
Seeded by default (`--init` + the one-time `grow-with-claudinite-seed` baseline migration for the
existing fleet), and **opt-out by removal**: baselining never re-adds it.

This pack carries the **repo-side** stages of the growth lifecycle: capturing a repo's own
lessons into its local packs, and pruning them once the shared canon covers them. The central
**promote** stage — which lifts portable lessons up into the shared canon — is a home-only duty
that runs canon-side, not a repo-side task, so it lives outside this pack.

Its scheduled work is five tasks under this pack's own `tasks/`, each discovered by the repo's
scheduler (`engine/scheduler/discover.mjs`) wherever the pack is declared:

| Task | Runs when | Where it lands |
|---|---|---|
| `growth-extract` ([tasks/growth-extract/task.md](tasks/growth-extract/task.md)) | the project changed in the window | the repo's own local packs, via a PR that auto-merges after CI |
| `growth-dedup` ([tasks/growth-dedup/task.md](tasks/growth-dedup/task.md)) | weekly, when the canon or the project's local packs moved in the week | the repo's own local packs, via a PR that auto-merges after CI |
| `growth-discover-packs` ([tasks/growth-discover-packs/task.md](tasks/growth-discover-packs/task.md)) | weekly | a new **local** pack in the repo's own `.claudinite/local/packs/`, via a reviewed PR |
| `prose-to-checks-sweep` ([tasks/prose-to-checks-sweep/task.md](tasks/prose-to-checks-sweep/task.md)) | weekly (no-ops cheaply on a quiet corpus) | a PR converting always-testable pack prose into checks |
| `rule-revalidation` ([tasks/rule-revalidation/task.md](tasks/rule-revalidation/task.md)) | weekly | a reviewed PR correcting rules whose environment claim no longer probes true |

(Plus two agentless daily tasks over the conversation-logs branch: [usage-fold](tasks/usage-fold/task.md),
described below, and `logs-prune` — retention, [tasks/logs-prune/worker.mjs](tasks/logs-prune/worker.mjs).)

## Extraction is one task over two sources

`growth-extract` is the whole capture stage, and it runs **three skills** in order:

1. [extract-from-activity](skills/extract-from-activity/SKILL.md) over the window's commits, merged
   PRs and issue discussion;
2. [extract-from-conversations](skills/extract-from-conversations/SKILL.md) over the logs captured
   from working sessions;
3. [prose-to-checks](skills/prose-to-checks/SKILL.md) over the prose **that run just wrote**, to see
   whether any of it upgrades to a check before the PR opens.

Everything lands in **one** PR, delivered to land where the repo's delivery settings allow
(`engine/scheduler/deliver-pr.md`). The two extraction halves used to be two tasks firing in
the same nightly anchor against the same local packs; they share the lesson bar, the promotion ladder
and the dedup surface ([extracting-lessons.md](extracting-lessons.md)), so the split bought nothing
and cost a second opus dispatch, a second PR, and two runs deduping against a corpus the other was
concurrently writing.

The third step is why the standing `prose-to-checks-sweep` is **weekly**: fresh prose is already
offered a conversion the night it is written, so what the sweep sees is a backlog that moves on a
weekly clock.

A member that wants the local stages without contributing lessons upstream **opts out of
promotion** on its own entry — `{ "id": "claudinite-growth", "config": { "promote": false } }`
— and the central promote stage skips it (absent or `true` = participate).

## The conversation lifecycle — capture in-session, extract in the daily task, retention

The pack also owns **extraction from working sessions**, replacing the old in-session post-merge
lessons pass. Capture and extraction split by what each needs: **capture** needs the live session
transcript, so it runs in-session (at merge, and again when the session ends); **extraction** only
reads the already-pushed logs, so it is the conversation half of the ordinary `growth-extract`
scheduled task — the logs branch is *in the repo*, so reading it, committing lessons to local packs,
and pruning are plain local git on the working tree; only posting the summary on the issue uses the
GitHub MCP tools.

1. **Capture — a step in the merge-to-main skill** (in-session, where the transcript lives).
   Right after a merge lands:
   `node .claudinite/shared/packs/claudinite-growth/capture-log.mjs --issue <n>`
   (in the canon repo itself: `node packs/claudinite-growth/capture-log.mjs --issue <n>`).
   Deterministic, seconds; it bundles the session transcript (sidechains inline, timestamp
   order), **scrubs enumeration-first** (every value the environment holds — `process.env`
   minus a short named allowlist of structural values, plus known credential stores — is
   redacted wherever it appears, with credential-shape patterns as the backstop; a secret the
   session itself transformed is beyond any static scrub, and push protection is the last
   net), and pushes one file per **capture event** onto the orphan **`conversation-logs`**
   branch: `<stamp>--issue-<n>--<session>.jsonl`, commits marked `[skip ci]`.
   **Delta-aware, keyed on the session id:** every capture pushes only the entries after this
   session's previous capture, whatever event produced it, so any two events chain into
   disjoint files and a zero delta pushes nothing at all. Double-writing is therefore safe by
   construction, not by coordination — the property [`session-end.mjs`](session-end.mjs) relies
   on, so `pack.test.mjs` pins it directly.
   The branch is a **work queue, not an archive** — never merged; tips are cheap in shallow
   session clones and retention keeps them bounded.
1. **Capture — again, when the session ends** ([session-end.mjs](session-end.mjs), invoked by the
   engine's SessionEnd hook runner for every active pack that ships one). Same capture, with
   `--issue 0`: **`0` means "no associated issue"**, and the filename shape stays byte-identical
   on purpose — the retention prune, the `conversationLogs` signal and the extract's filename
   parse all already accept it, whereas a *new* shape would be invisible to the prune and become
   immortal on the branch. This event is what captures the sessions that never merge (a review, an
   investigation, a session that ended in a question) and the post-merge **tail** of the ones that
   do. **Best effort:** a container reclaimed by timeout never fires it, so nothing depends on it
   having run — every firing enriches the record, every miss leaves exactly the merge-only
   behaviour. An `issue-0` log has no issue for the extract to post its exchange
   summary on; nothing else about its lifecycle differs.
   **Unattended sessions capture through the same step, deliberately not through the hook.** A
   scheduled task's executor session ends by having its container reclaimed, which is exactly
   the ending no `SessionEnd` fires on — so the executor runs the engine's runner itself as its
   last step and names its work item in `CLAUDINITE_SESSION_ISSUE`, which this step uses in
   place of `0`. Those logs therefore file under the task that ran (the item's title
   names `pack/task`), and the work no human watched becomes as countable as the work one did.
2. **The pass — the conversation half of [growth-extract](tasks/growth-extract/task.md)**
   (precondition: a substantive merge; local git on the repo's working tree, MCP only for the issue comment). It
   applies the [extract-from-conversations](skills/extract-from-conversations/SKILL.md) skill (the
   friction signals and the measured efficiency analysis, computable from the log's timestamps and
   token usage) over [extracting-lessons.md](extracting-lessons.md)'s shared bar, routes keepers into
   the member's local packs, and posts on the worked issue, for each rule that landed, a
   **200-word-max** summary of the slice of conversation that caused it — the dialogue itself is
   never pasted there, it is far too verbose for an issue —
   **extraction is the only path to permanence**: a log that yields no rule gets no comment,
   and its conversation is gone once retention deletes it (a deliberate owner call).
3. **Deletion — the agentless `logs-prune` task**
   ([tasks/logs-prune/worker.mjs](tasks/logs-prune/worker.mjs)), daily, over the same branch: every
   capture past `config.retention_days` is removed, on the stamp in its filename alone. What makes
   that safe without an agent is the reading window above — the extract run reads from the oldest end
   of the branch on every run, so a capture reaches retention having been read. **Unset retention = the
   prune deletes nothing** (capture-only, fail-safe).

No adoption question over it — `retention_days` stays unset (hidden) by default, which is
fail-safe (capture-only). A project that wants the prune active sets `config.retention_days`
itself (10 is the recommended floor); nothing else to schedule, since both tasks ride the
fleet's one daily run like the other growth tasks.

## Skill-usage metrics — what the mounted skills actually do

Mounting a skill only puts its name and one-line description into the session prompt; whether the
model ever **loads** it is discretion, and nothing recorded it. So the promotion ladder's
skill-vs-prose call had no empirical feedback: a skill whose trigger never fires looked exactly like
one that fires daily, and a "skill" that loads in every session (rules wearing a skill's clothes)
looked exactly like a genuinely activity-scoped one.

The [usage-fold](tasks/usage-fold/task.md) task closes that loop — daily, agentless, seconds. It
counts skill loads **and their denominators** (captures, merges, sessions, user messages, user
commands) out of the logs this pack already captures, into
`.claudinite/local/usage.GENERATED.json`: day rows recomputed statelessly inside the raw retention
window, week rows appended once past a `foldedThrough` watermark. Denominators are the point — a raw
count cannot tell healthy-rare from broken, so the question is loads *against the sessions where that
skill's own declared trigger plausibly applied*. Zeros are implicit (a skill with no loads has no
key), which is what makes "never loads" visible: diff the file against the repo's mounted skills.

Fleet-wide aggregation is deliberately **not** here — the canon knows mechanisms, never repos. It is
the sheepdog pack's [`fleet-usage`](../sheepdog/tasks/fleet-usage/task.md) task, in the fleet-enforcer
repo, which is the only place that knows who the members are.

## Skills

Each stage's **method** lives in a skill, so the task doc frames the unattended run and the same
method is available to an owner asking in-session. Extract's three are listed above;
[**growth-dedup**](skills/growth-dedup/SKILL.md) is the dedup stage's — what to prune, strip, or
rephrase, the keep-test, and the shrink-only discipline. The pack also bundles
[unattended-agents](skills/unattended-agents/SKILL.md) and
[generate-project-instructions](skills/generate-project-instructions/SKILL.md). Adoption itself —
`adopt-claudinite`, `adopt-pack` and the `adopt-requested-packs` task — is the
[claudinite-lifecycle](../claudinite-lifecycle/README.md) pack's: its subject is Claudinite's own surface, not lesson capture.

## Rules (`RULES.md`)

| Rule | Severity | Reason | Enforcement |
|---|---|---|---|
| Writing or changing a scheduled task | high | correctness | prose: 26 words + checks (`task-declaration-shape`, `task-declaration-matches-folder`, `task-code-work-env`) |

## Coded rules

| Rule | Kind | What |
|---|---|---|
| `dedup-prune-integrity` | work-scope ([dedup-integrity.mjs](dedup-integrity.mjs)) | a dedup edit only removes portable text — never grows a local pack or re-imports a canon rule |
| `growth-write-scope` | work-scope ([growth-write-scope.mjs](growth-write-scope.mjs)) | a capture run (extract, dedup) writes only the repo's own local packs |

The capture runs' write surface is the local packs and nothing else — a run improves the repo's
**packs**, never the canon it prunes against or the project's own code. `growth-write-scope` is
the machine guarantee behind that, keyed on the pinned commit titles of exactly those two runs; the
lifecycle's wider-surfaced runs have their own gates (promote writes the canon under `packs/` and
`skills/`, certified by canon-curation's `promote-scope`; pack discovery also writes the repo-root
declaration that activates the pack it authors).

**Pack discovery** ([tasks/growth-discover-packs/task.md](tasks/growth-discover-packs/task.md)) is
an ordinary weekly task on the repo's own scheduler. The repo runs the whole pipeline over
**itself**: manifest its stack, hold it against the canon packs already on its shelf and its own
existing local packs, and — for genuinely project-specific knowledge neither homes — author a new
**local** pack populated from its real usage, landed through a **reviewed** PR (a new pack ships new
`.mjs` checks, and a check can break CI — the same reason `prose-to-checks-sweep` is reviewed, and
the one place this stage differs from extract). It writes only the repo's own
`.claudinite/local/packs/`; lifting a local pack up into the shared canon is the central promote
task's job.

## Rules expire when the environment moves — revalidation

Capture, dedup and conversion all assume a rule is either right or superseded. A third failure mode
has no local signal at all: the rule was right, and the **world** changed. A claim that the harness
rejects a call in some shape, that the Action's token cannot push a path, that an MCP tool exists —
each is a fact about a platform this repo does not control, and when it stops being true nothing
here goes red. The prose keeps reading as authoritative, sessions keep obeying it, and the cost
lands as a session spent on a route that closed.

[rule-revalidation](tasks/rule-revalidation/task.md) is the weekly re-probe. It slices the corpus by
longest-since-probed, **runs** the smallest read-only thing that would distinguish true from false
for each environment-dependent claim, and corrects what the probe contradicts — in a reviewed PR
whose body carries the probe evidence, since that is the one thing a reviewer cannot re-derive from
the diff. Its scope is the same `pack_paths` config `prose-to-checks-sweep` reads, so a repo names
its capture surface once.

The dangerous verdict is the one it refuses to reach. An executor session carries the reach its
repo's routine was provisioned with, which is not the reach every rule was written under, so a probe
that cannot run is logged **unprobed** and the rule is left untouched. Rewriting a rule into "you
cannot do X" because one session could not is unfalsifiable afterwards and removes the capability
from every future session — which is why the corpus each run touches is small and every verdict is
logged on a standing tracker, including the ones that changed nothing.

## Identifying a project's capture surface: its local packs (the same way in every stage)

Every growth stage operates on a project's **local packs** — the tracked packs a repo keeps under
`.claudinite/local_packs/<pack>/` (prose in `RULES.md`, checks in the pack's `rules`, activity
procedures as the pack's skills, scheduled tasks under its `tasks/`). That subtree **is** the
project's own content;
the rest of `.claudinite/` is the **read-only mounted canon** and is never a capture, prune, or
promote target. So "a project's local packs" means precisely *everything under
`.claudinite/local_packs/`, and nothing else under `.claudinite/`*. This is the normalized capture
surface — a structural set the stages read the same way, not a `CLAUDE.md`-graph walk over stray
Markdown (a repo with no local packs yet simply has nothing to extract, dedup, or promote here; a
project adopts the structure via the `generate-project-instructions` skill).

Prefer the strongest mechanism the lesson allows — the **local promotion ladder**, applied at the
project's own level: a deterministic rule becomes a **check** whose failure message carries the lesson —
a **declared** one in the owning pack's `declared-checks.json` wherever patterns over files can say it,
a **rule module** in its `rules` only where they can't — an activity-scoped procedure becomes a **pack
skill**, and only what none of those can carry lands as **prose** in a pack's `RULES.md`. A check relieves every session's
context completely where prose only relocates it, so capture writes *more checks and less prose*.

The stages differ only in *how they read that set*, never in *which set it is*: extract and dedup
run against the member repo and read the local packs from the working tree; promote runs centrally
and reads the same subtree over the GitHub API (get-file-contents under `.claudinite/local_packs/`).
Extract writes into it, promote reads from it, dedup prunes within it — all against the identical,
`.claudinite/local_packs/`-rooted set.

## Checks

| Check | Severity | Reason | Enforcement |
|---|---|---|---|
| `dedup-prune-integrity` | high | correctness | check: blocking |
| `growth-write-scope` | high | correctness | check: blocking |
| `in-session-github-access` | high | correctness | check: blocking |
| `routine-structure` | medium | complexity | check: blocking |
| `task-declaration-shape` | high | correctness | check: blocking |
| `task-declaration-matches-folder` | high | correctness | check: blocking |
| `task-code-work-env` | high | correctness | check: blocking |
| `task-phase-discipline` | medium | complexity | check: advisory |

The last four are the **scheduled-task contract** ([scheduled-tasks.md](scheduled-tasks.md)), which
lives here rather than in [claudinite-lifecycle](../claudinite-lifecycle/README.md) because it judges
whether a task is *written* correctly — authoring, the subject of this pack — and not whether
Claudinite is *working* in the repo, which is that one's. Relevance-first: all four are inert until
the repo carries a `tasks/<name>/task.mjs` of its own.

- `task-declaration-shape` — a task declaration the scheduler reads is incomplete or illegal, so the task never fires or fires wrong.
- `task-declaration-matches-folder` — a declaration disagrees with its folder: discovery drops it into `errors` and every run keeps reporting healthy without it.
- `task-code-work-env` — a task reads a `CLAUDINITE_*` variable code-work never sets, so a parameter (a scope filter, a dry-run switch) silently never arrives and the run goes green in its most dangerous mode.
- `task-phase-discipline` — a task decides not to run after its precondition already said run, hiding the decision from the run records.
