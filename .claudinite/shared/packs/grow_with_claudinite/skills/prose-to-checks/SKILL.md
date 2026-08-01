---
name: prose-to-checks
description: Mine a repo's existing pack prose (RULES.md, SKILL.md) for always-testable rules that were never converted to checks, and convert the strongest ones. Use when auditing packs for convertible rules, or when the growth prose-to-checks sweep runs.
---

# Convert existing prose to checks

A completeness-critic over a repo's own packs. The growth *extract* stage converts each **new**
lesson down the promotion ladder; this pass sweeps the **existing** prose backlog for rules that
are always-testable but still live only as prose — and converts them, so the packs keep shedding
context over time instead of only at the moment a rule is first learned. It runs as
grow_with_claudinite's daily `prose-to-checks-sweep` task, and on demand.

## Scope — the pack paths you were given

Work only the **pack paths configured for this repo** (the task passes them in its Context): a
consuming repo's own **local packs** (`.claudinite/local/packs/`) by default — projects don't
improve core canon packs — while **Claudinite itself** also sweeps its core `packs/`. Read the
prose under those paths (each pack's `RULES.md`, and any `SKILL.md` beside them). Never edit a
read-only mounted canon pack under `.claudinite/shared/`.

## First gate — a working rule, not a product statement

Before asking whether a rule is *testable*, ask whether it belongs to a pack at all: **does it govern
how we work, or state what the product does?** A pack — canon or local — homes the conventions,
gotchas and review discipline that recur across tasks whatever the feature happens to be. A rule
asserting which entities exist, what a surface must render, or that a feature's parts are wired to
each other is a **requirement**; its home is the project's executable spec and the suite that proves
it (the full rule lives in
[generate-project-instructions](../generate-project-instructions/SKILL.md)).

This gate comes **first** because product statements sail through the check-the-world test below —
"this module must export `X`" has an obvious static signature. Converting one splits a feature's
definition across two systems and lands half of it in the one no test of the product ever reads.
Load-bearingness is not the test: a real gap in product coverage is a *requirements* gap.

A product statement already sitting in pack prose is mis-homed, and a sweep is not the place to
re-home it. **Leave the prose and log it** as a mis-homed rule, the same way an un-checkable
candidate is logged — never cement it as a check.

## What to look for — the check-the-world test

For each rule that cleared the gate, ask the one question from
[engine/checks/DESIGN.md](../../../../engine/checks/DESIGN.md): **does it constrain a *static
signature in the repo artifact* — something a post-hoc scan could observe?**

- **Yes → a conversion candidate.** A dangling-reference rule, a filename convention, a workflow
  or manifest shape, a "these two files must agree" invariant, a forbidden pattern in code.
- **No → leave it.** In-flight process (leaves no artifact — "see the test fail first"),
  judgment ("name by scope"), or knowledge whose failure is only visible at runtime (jsdom
  diverging from Chrome). These are why the rule is prose; don't force them.

**A static signature is necessary, not sufficient.** Both shapes the working-discipline rules bar
— a rule that pins today's code in place, and one derivable from the product's requirements —
answer *yes* here, so screen every candidate against that bar before converting it. Leave either
where it is; routing a requirement to the spec and its suite is its own change, not this sweep's.

The check-the-world rule from DESIGN holds: if a rule is always-testable, it was never really
part of the on-demand skill — it belongs in a pack as a check.

## How to convert one

Follow the extract stage's check-authoring discipline (the local promotion ladder in
[extracting-lessons.md](../../extracting-lessons.md)). For each candidate:

1. **Author the check** in the owning pack (`<pack>/<rule>.mjs`, listed in its `pack.mjs`) — the
   failure message *is* the rule (what / why / fix / `doc:` pointer back to the prose).
2. **Write the fixture first and see it fail** — a violating fixture must find, a clean one must
   not (the test lives beside the pack's other tests). A conversion with no proving fixture
   doesn't ship.
3. **Ship at real severity, fail-fast** — blocking for a defect, advisory only when the rule is
   directional by kind.
4. **Delete the prose the check now covers** — whole, never trimmed. The deletion test below is
   how you decide which paragraphs those are.

**Before writing a rule off as un-checkable, try parsing the file's structure instead of grepping
its text.** Grep finds the pattern anywhere; parsing finds it in the one spot the rule means —
which kills the false alarm. (Example: `Authorization` is only wrong inside a CloudFront policy's
*own* header list, not elsewhere in the template.) Parse only as much as you need, and hold the
check to the same fixture bar.

When even a scoped parser can't make detection confident, **leave the prose and log the
candidate** to a tagged conversion-backlog issue rather than shipping a shaky check.

## Coming out: the deletion test

Coming out of a conversion, apply the **deletion test**: prose a mechanism fully covers is
deleted, never trimmed. Ask it of every paragraph standing beside a landed check — *with this
paragraph gone, would the check still catch every violation it describes **and** tell the agent
how to fix it?* If yes, it is redundant: delete it whole. The check's failure message is where
the rule lives now and its header comment is where the rationale lives, so a paragraph restating
either pays twice and is the drift trap waiting to spring.

Before concluding prose is the only carrier, look at the pack's **skills** too — an
activity-scoped skill often already holds the map a rule is repeating. Keep only what no artifact
carries.

The test **discriminates** rather than just deleting: a paragraph stays whole whenever it carries
something the check does not — a second rule in the same breath, an exemption the check can't
encode, a value the check can't judge, or a remedy the finding's own `fix` line never states
(a finding renders `what` / `why` / `fix` / `doc`, never the rule's `description`, so a remedy
that lives only in the description is not carried). Two worked calls: an `npm test` invariant
went entirely — the check caught it and the testing-guide skill already listed the suites —
while an `extension-test/` mirror bullet stayed, because the check beside it enforced only the
`package.json` list's sync with the tree and never the mirror convention itself.

Whether a check covers a rule is a judgment about meaning, so this test is applied by a
**reader**, not mechanized.

## Bounds

- **One PR, bounded surface** — the new rule module, its `pack.mjs` line, its fixture, and the
  trimmed prose. Don't "improve" unrelated rules while you're in there.
- **Never delete a rule you didn't convert** — the deletion test is only ever asked of a rule a
  *landed* check now enforces.
- Run the suite and the sweep green before opening the PR; open it for the owner's approval,
  never a direct push to `main`.
