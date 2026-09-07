# Extracting lessons — the bar and the local promotion ladder

> **Scope: what both extraction skills share.** This doc is the **bar** a lesson must clear and the
> **ladder** it descends once it clears it — the half that is identical whatever the lesson was mined
> from. What each *source* adds is owned by its own skill:
> [extract-from-activity](skills/extract-from-activity/SKILL.md) for commits, merged PRs and issue
> activity, and [extract-from-conversations](skills/extract-from-conversations/SKILL.md) for a session's
> dialogue. Both load this doc; neither restates it.

Its callers are the growth pack's [growth-extract](tasks/growth-extract/task.md) daily task, which runs
both skills over one window, and an owner's occasional plain-words ask for a retrospective.

## Run the pass on a capable model

Extraction is mechanical, but deciding *what clears the bar* is a judgment call a weaker model fails
silently — it ships a plausible-but-wrong "lesson" where a capable model correctly bails (see
[the unattended-agents skill](skills/unattended-agents/SKILL.md), "Match the agent model to the judgment it
must make"). The terse rules that *govern* the pass — run it, plus the separate efficiency analysis — also
live there; this doc is the how-to.

## From signal to lesson — the bar

A signal is only worth writing down when the fix is **durable, reusable, and generalizable beyond this one
session or window.** Before adding anything:

- **Dedupe ruthlessly** against the existing packs — a lesson already covered (even worded differently,
  even in another pack, even enforced by a check) is not a new lesson.
- **A dedupe miss has a second reading**, and when the candidate rule names an identifier you don't
  own — a function, field or setting — it is the likelier one: grep that identifier in the
  dependency's **code** before landing anything. No hit usually means the mechanism was retired and
  the rule is *expired*, not that the lesson is novel.
- **One-offs don't qualify.** A situational detail, a restatement of a generic truism, or something already
  implied by an existing rule is below the bar.
- **Never capture a rule that teaches routing around a permission, security, or classifier denial.** A
  pattern of "it was denied, then succeeded on retry" is real signal about *reliability*, not license to
  write a rule instructing every future session to retry, ignore, or explain past such a denial without
  asking — however solid the retry evidence looks, that shape of lesson never clears the bar. Report a
  recurring denial to the owner instead; a checked-in instruction that tells unattended sessions to bypass
  a safety gate is a standing bypass with no consent behind it, however it got there.
- **Promote what's portable.** A lesson true for projects beyond this one belongs in shared, cross-project
  canon, not stuck in one repo's local packs — the growth lifecycle's promote stage lifts it there
  centrally; capture it well locally and let promote generalize whatever travels.

## Route to the local pack that owns it — the promotion ladder

A project's capture surface is its **local packs** (`.claudinite/local/packs/<pack>/`); everything else
under `.claudinite/` is the read-only mounted canon and is never a capture target. Pick the pack whose
territory the lesson belongs to (most repos have one general pack; some segregate a domain pack), then
prefer the strongest mechanism it allows:

**First check whether a canon pack already owns it, from the catalog and not from the mount.** A repo
holds only the packs it *declares*, so "nothing here covers this" is a fact about the mount rather than
about the corpus — and acting on it homes the lesson locally in territory a canon pack already owns.
Read `.claudinite/shared/packs/directory.GENERATED.md` (canon-side `packs/directory.GENERATED.md`),
which states every canon pack's boundary including the ones this repo doesn't hold. Where the owning
pack's stated territory is merely too narrow, propose widening it rather than routing around it.

1. **A schema property** — when the lesson is about a document's *shape*: a field that must be present, a
   value from a closed set, a type, a key set nothing may extend. It belongs in the JSON Schema the document
   points at with `$schema` (created from the first such rule where the document has none), which an editor
   shows while the document is written and the engine's `schema-conformance` check enforces for every such
   document at once. Anything a schema can enforce is better handled there: a declared `checkParsedFiles`
   assertion over a field, or a coded rule re-reading a document's shape by hand, is a schema check in
   disguise. Only what a schema cannot say — a relation between two documents, a value that depends on the
   tree — goes on to the rungs below.
2. **A declared check** — an entry in that pack's `declared-checks.json`, whose `failureMessage` *is* the
   lesson. Nothing wires it: writing the declaration adds the check. Declare it at the moment its signature
   lives: a **world** check over the tree — one pass ("these patterns over these files"), or two when a value
   read in one place must agree with, exist in or be absent from another (`extractValueSets` derives the set,
   `checkSetValues`/`checkSetPairs`/`requireIdenticalFiles` quantify over it); a **work** check over the
   change (`scope: "work"` — the lines it adds or removes, a co-change, an untracked file, the session's
   declared comment classes); or an **action** guard on a tool call (`scope: "action"`, `guardToolCalls` —
   denied or nudged at PreToolUse, backstopped over the transcript at Stop). Most captured conditions are
   one of these, and a lesson about *how an operation is performed* is usually the third. Give it
   `severity: 'blocking'` and `since: '<today>'`: the engine holds a check to advisory for its first two
   weeks, so a check may land against a tree that still violates it and the backlog it surfaces is somebody
   else's next change, not this run's.
3. **A custom code rule** — a `<rule>.mjs` exporting `run(ctx)`, listed on the pack's `pack.mjs` — only
   when the check needs what patterns can't say: real parsing, structured-data field logic, git/diff or
   conversation state, a derived comparison. Reaching for code where a declaration would do costs a module
   to read and maintain for nothing. An **unattended** run ships one `advisory`: hand-written logic has
   failure modes a declaration cannot have, and nobody reviewed this one.
4. **A pack skill**, when the lesson is an activity-scoped procedure or a bias rather than a condition —
   and name the moment it must load under its `metadata`: `force-load-on-file-edits-paths`,
   `force-load-on-tool-calls` (opening a PR, committing, merging, fetching), `force-load-on-prompts-matching`
   (an owner's command phrase) or `force-load-on-tool-results-matching` (a symptom in a result). A skill
   with no trigger loads on description alone, which is model discretion; a procedure keyed to an act has a
   call to name, and rules sharing a trigger belong in one skill so one load carries the whole procedure.
5. **Terse prose** in the pack's `RULES.md` — the fallback, only what none of the above can carry.

Either check rung ships with a **red-first fixture**; the declaration vocabulary is documented in
[`pattern-rules.mjs`](../../engine/checks/helpers/pattern-rules.mjs)'s header, and the authoring shape for
both rungs — with the `since` grace window — in
[`engine/checks/README.md`](../../engine/checks/README.md#adding-a-rule).

**Two check shapes are below the bar however cleanly they'd be written**: one that asserts particular code
exists or still reads a particular way (it pins a point in time and reds the next legitimate edit), and one
derivable from the product's own requirements (that is a requirement — it belongs in the tests).

Write **more checks and less prose**: a check relieves every session's context completely, where prose only
relocates it. **Prose is rationed, and the ration is small** — a pass adds at most two rules, each one
sentence. How a rule is phrased and sized, and where its rationale goes — the brief rule in `RULES.md`, the
reaffirmable reason in the pack's `references.md` — is the
[writing-pack-prose](skills/writing-pack-prose/SKILL.md) skill's; load it before writing any. The full
evidence trail stays in the PR body and the issue.

When no pack's scope fits, the lesson lands in the repo's general local pack. A **new** local
pack is justified only by the repo's own **project structure** — a segment of the repo's tree whose work is
its own territory (a `client` pack for work under `client/`), so a repo's local packs mirror its layout.
**Never mint a local pack around a technology or a methodology**, however real the knowledge: capture those
lessons in the structural pack that owns the work, and let the canon-side promote stage — Claudinite's call,
never a member's — decide whether a technology or methodology facet earns a pack of its own.

**A gotcha tied to one call site is not a pack rule at all, and it is not this pass's to land either.** A
trap from misusing a specific API, class, or library belongs as a comment at that usage site — and a capture
run's write surface stops at its own packs, so **drop the candidate** rather than inflate it into a pack
rule or collect it into a centralized gotchas list. The comments in a repo's own source belong to the
basics pack's `improve-comments` task, which has its own trigger and its own review surface. Reserve a
central gotchas doc for what no single usage site owns: a trap you could hit *without* reading the relevant
file (a mistake of omission), or a cross-cutting invariant.

**Two kinds never become a pack rule, however strong the evidence** — filter on what the lesson is *about*
before picking a mechanism. (1) **The owner's own preferences** — which word authorizes a merge, tone, how a
summary is shaped. They belong to the person, are injected per session from their own preference file, and
change without any repo hearing about it; a pack copy goes stale silently and then contradicts the live one.
(2) **The agent framework's own loading mechanics** — which packs are declared, why a skill didn't mount, why
an injection missed. That's engine plumbing, not project knowledge: a real defect there is filed upstream, and
writing it down as a project rule preserves the bug instead of fixing it.

## "No new lessons" is a valid — and common — result

Most sessions and most windows yield nothing durable, and that's the expected outcome. Say so and write
nothing rather than padding the docs to look productive: a spurious or duplicative "lesson" pollutes the
canon and costs every future reader. **Default to no edit when unsure** — the bar is a genuinely new,
reusable insight, not a diary of what happened.
