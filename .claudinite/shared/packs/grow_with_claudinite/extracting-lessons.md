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
- **One-offs don't qualify.** A situational detail, a restatement of a generic truism, or something already
  implied by an existing rule is below the bar.
- **Promote what's portable.** A lesson true for projects beyond this one belongs in shared, cross-project
  canon, not stuck in one repo's local packs — the growth lifecycle's promote stage lifts it there
  centrally; capture it well locally and let promote generalize whatever travels.

## Route to the local pack that owns it — the promotion ladder

A project's capture surface is its **local packs** (`.claudinite/local/packs/<pack>/`); everything else
under `.claudinite/` is the read-only mounted canon and is never a capture target. Pick the pack whose
territory the lesson belongs to (most repos have one general pack; some segregate a domain pack), then
prefer the strongest mechanism it allows:

1. **A check** in that pack's rules — author the `.mjs`, list it on the pack's `pack.mjs`, ship it with a
   red-first fixture. Its failure message *is* the lesson.
2. **A pack skill**, when the lesson is an activity-scoped procedure rather than a condition.
3. **Terse prose** in the pack's `RULES.md` — only what neither of the above can carry.

Write **more checks and less prose**: a check relieves every session's context completely, where prose only
relocates it. When no pack's scope fits, the lesson lands in the repo's general local pack. A **new** local
pack is justified only by the repo's own **project structure** — a segment of the repo's tree whose work is
its own territory (a `client` pack for work under `client/`), so a repo's local packs mirror its layout.
**Never mint a local pack around a technology or a methodology**, however real the knowledge: capture those
lessons in the structural pack that owns the work, and let the canon-side promote stage — Claudinite's call,
never a member's — decide whether a technology or methodology facet earns a pack of its own.

**A gotcha tied to one call site is not a pack rule at all.** A trap from misusing a specific API, class, or
library goes as a **comment right at the usage site** — next to the call itself, where the next editor of
that line sees it — never collected into a centralized gotchas list. Co-locate it in a file's own header
comment when the trap spans the whole file and you'd only hit it *while editing that file*. Reserve a
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
