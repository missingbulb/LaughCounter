---
name: growth-dedup
description: Prune a repo's local packs of items the mounted Claudinite canon now covers — remove, strip to residue, or track a wording drift, never grow an entry. Use when the growth dedup task runs, or when asked to reconcile or dedup local packs against the canon.
---

# Dedup local packs against the canon

The **method** of the growth lifecycle's pruning stage: reconcile a repo's own **local packs**
(`.claudinite/local/packs/`; legacy `.claudinite/local_packs/` accepted during the rename
window) against the shared canon it consumes, pruning local items the canon now covers. Two
callers share it: the unattended [growth-dedup task](../../tasks/growth-dedup/task.md) (which
frames the run — dispatch, the human-gated PR, tracking issue), and an owner asking in-session
to reconcile local packs against the canon. Often there's nothing to prune, and that's fine.

**The yardstick is the mounted canon** — the exact revision the repo currently consumes, what
`.claudinite/shared/` holds at the mount's stamp — never a live fetch (a promotion is visible
here only once baselining has converged the mount to include it). The mount is never a prune
*target*, only what you prune *against*.

## The three actions — every one removes portable text

- **Remove** a now-duplicated local item, since the canon is the single source of truth for
  portable rules.
- **Strip** a *partially* covered item down to its residue — when an item's general half is now
  canon-owned but it still carries a stronger point about a narrower case, **delete the portable
  half in place and keep only the residue**. A strip is a **deletion that shrinks the entry**:
  lead with the residual point (using the file's own `(canon)` tag convention if it has one),
  never with a meta-line like "this rule is portable (canon)", and **never re-state the
  now-canon rule, its fix, or which pack owns it** — carrying it is exactly what you are
  removing. If your "strip" adds words or restates the canon, you have *un*-deduped the item:
  keep the pre-edit text instead.
- **Rephrase** a local procedure *only* when the canon's wording of the same idea has changed,
  so the local packs stay consistent with the canon they point at — a rephrase tracks a wording
  drift; it never grows the entry and never re-imports canon prose.

An edit that leaves an entry the same size or larger, re-quotes the now-canon rule, or names the
owning pack's fix is a **corruption, not a dedup**. When in doubt about a kept item, leave it
byte-for-byte unchanged rather than "reconcile" its wording. The `dedup-prune-integrity` check
([dedup-integrity.mjs](../../dedup-integrity.mjs)) is the machine backstop: it reds the session
when a dedup-labeled commit grows a local-pack prose file, or when any change adds a line that
restates a canon rule.

## The keep-test: says *more*, not merely says it more specifically

Every local item is more specific than the canon, so specificity alone is never the test.
Distinguish two cases:

- **The general rule in local dress** — it makes the canon's point but leans on this repo's
  classes, files, or names to make it. Once the canon covers the point, those names were only
  illustration: prune it.
- **A stronger point about a narrower case** — it asserts something the canon's general rule
  leaves out: a tighter constraint, a sharper claim that holds for this repo's narrower
  situation. Keep it.

So ask not "is it specific" (it always is) but "does it only lean on specific names to make the
general point, or does it make a point the canon doesn't?" Prune the first; keep the second.

## A canon check covers an item too — and more strongly than prose

The canon carries rules as **conformance checks**, not only prose. A local item is covered when
a canon check *enforces* it — stronger coverage than a stated line, since the rule runs on every
session and CI pass. Consult the machine-readable rule catalog
(`node .claudinite/shared/engine/checks/check_the_world.mjs --list`: id, severity, description,
doc pointer — it lists the active local packs' own checks too) alongside the prose corpus, and
when a check covers the item, **quote the rule id** where you'd otherwise quote a canon line.
This cuts both ways: a **local pack's own check** is redundant once a canon check enforces the
same rule — prune the local `.mjs` (and drop it from `pack.mjs` + its fixture) exactly as you'd
prune a duplicated prose line. The keep-test above is unchanged.

## Discipline

- **Only remove a local item you can show the mounted canon genuinely covers — quote the canon
  line (or the covering check's rule id).** When unsure, leave it; a wrongful prune deletes a
  real local lesson.
- **Write only inside the local packs.** A dedup run's whole surface is
  `.claudinite/local/packs/` — never the canon it prunes against, never the project's own code. The
  `growth-write-scope` check ([growth-write-scope.mjs](../../growth-write-scope.mjs)) keys on the
  run's pinned `Claudinite growth: dedup local packs` title and reds any path outside that surface.
- If an edit touches something a test reads, run the repo's offline test suite and keep it green
  before delivering.
