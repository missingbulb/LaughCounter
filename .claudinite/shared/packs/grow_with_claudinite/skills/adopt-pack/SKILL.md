---
name: adopt-pack
description: Add one or more packs to an already-adopted Claudinite member — declare, run each pack's adoption interview, re-vendor, scaffold, land. Use when asked to adopt, add, enable, or declare a pack (e.g. product-wiki, executable-requirements) on a repo that already runs Claudinite.
---

Adding a pack to a repo that already runs Claudinite. Whole-repo bootstrap and the on-demand
refresh are [adopt-claudinite](../adopt-claudinite/SKILL.md); this is the narrower act of turning
one or more packs on. The declaration is authoritative — declaring is the project's call — so the
work is: declare, answer what the pack asks, materialize its content, satisfy what it now demands.

## 1. Declare

The full directory of adoptable packs — every canon pack with what it covers, how it activates,
and what it requires — is vendored in the mount at `.claudinite/shared/packs/directory.GENERATED.md`
(canon-side: `packs/directory.GENERATED.md`); read it when choosing, or when the owner asks what
could be added. **Match the owner's plain-words name to a pack id yourself** before asking them to
disambiguate — pack ids rarely read like how people describe them, so read the candidate's entry
there and confirm the fit.

Add each chosen pack's id to `packs` in `.claudinite-checks.json`. A pack that only makes sense
alongside another names it in `requires`; `resolveDeclaredPacks` pulls that closure in when the
declaration is written, so you declare what you *chose* and its dependencies follow (e.g.
`spec-driven-product` pulls `executable-requirements`). An unknown pack name — or an unknown
property on an entry — is a blocking **settings** error, not a conformance finding; fix the name.

## 2. Interview — the part that is easy to skip and must not be

A pack that needs the project's intent before it can provide value declares `questions` on its
manifest (see [packs/README.md](../../../README.md) and the machinery in
[../adopt-claudinite/interview.mjs](../adopt-claudinite/interview.mjs)). For **every** newly
declared pack that asks questions:

- Where a question says the repo may already hold the answer (a product brief, an existing
  requirements doc, the issue tracker), **read that first and confirm** rather than asking cold.
- Otherwise ask the owner directly (`AskUserQuestion`), one question at a time, at the point of
  adoption — when a human asked for the adoption, they are present by construction.
- Record each answer **verbatim** on that pack's entry as `answers: { "<question-id>": "<text>" }`.
  `"n/a — none wanted"` is a valid answer and stops the asking. Where the question carries a
  `distill` note, derive the entry's `config` from the answer (e.g. `executable-requirements`'s
  spec path → `config.spec`).

### When nobody is there to ask

Adoption also runs **unattended** — a scheduled task acting on a recommendation, the
fleet-add-missing-packs task's agent stage, any run with no human in the loop. The interview is then the hard stop, and
the order matters:

1. **Never guess an answer, and never leave the question unrecorded.** A pack whose question is
   answered by inference carries a decision nobody made, in a file that then propagates by
   `requires` closure and outlives whoever could have corrected it. `"n/a"` is an *owner's* answer,
   not a default you may write on their behalf.
2. **Finish everything the question does not gate, first** — declare, re-vendor, refresh the badge
   row, scaffold, and get the checks green (§4, §5). Stopping at the question with a red repo hands
   the owner a broken tree *and* a question; stopping with a green one hands them only the question.
3. **Then stop, and hand off in the open.** Open the PR with what is settled, name each unanswered
   question in the PR body under a heading that says the adoption is incomplete, and say the same
   on whatever issue prompted the run. Do **not** merge, do not proceed to a next pack's interview,
   and do not re-run the adoption on a later firing hoping the answer appeared — an unanswered
   question is a human's, and re-asking it weekly is nagging.

A pack that asks nothing adopts fully unattended; this section costs it nothing.

## 3. Re-vendor

The new packs' prose, checks, and skills must land under the tracked `.claudinite/shared/` mount,
**and the repo must be stamped with the version it is now at.** Fetch a fresh canon to scratch and
run its install runner against the checkout — sessions never fetch:

```
node <canon>/updates/install.mjs --target . <pack-id> [<pack-id>…]
```

**Do not hand-roll this with `apply-vendor-set.mjs`.** That lays the files down correctly and gets
one thing wrong that nothing notices for weeks: it never writes
`claudinite.packVersions[<id>]`. The pack is then installed but *unversioned*, so the next update
flow reads `from: null` and — unable to compare numbers — falls back to the landed-date window,
which can hand a freshly adopted pack records written for the shapes of an older era. "An install
runs no migrations" is a correctness rule, and the stamp is what enforces it.

The runner declares each pack, vendors its content, stamps it and every pack in its `requires`
closure at the newest version, runs any one-shot seed ops, and gates on the converged tree's own
self-test. It exits non-zero on a refusal or an unanswered interview — a pack already installed is
**refused**, because reinstalling would restamp the repo to the newest version while skipping every
record in between.

Then **refresh the README pack-badge row**, from the mount you just rebuilt:

```
node .claudinite/shared/engine/scheduler/converge-wiring.mjs <owner/repo> --badges
```

Declaring a pack is what makes that row wrong, and adoption is the only moment anything derives it —
the nightly deliberately leaves a repo's README alone, so a row not refreshed here stays stale until
someone notices by eye. The converge rewrites the row in place between its
`<!-- claudinite:packs -->` markers, keeping whatever the repo wrote after the closing one, and is a
no-op when the row is already right. A repo that has deleted its row keeps it deleted only if you
skip this — dropping the row is a real choice, so don't re-seed one the repo removed on purpose.

## 4. Scaffold what the pack now demands

A newly active pack may require structure the repo doesn't have yet — deliberately, so the
declaration is a statement of intent that its own findings then guide you to satisfy. Run the
world sweep and let each finding name the file: e.g. `product-wiki` wants its index and the
reviewed `product-requirements/` sink before the isolation wall has anything to guard. Scaffold
per the pack's own README template; the pack's rules are the checklist.

## 5. Land

World and work checks green (`.claudinite/shared/engine/checks/check_the_world.mjs`; the Stop hook
carries the work checks). Commit referencing the task's issue, push, open one PR. Content a pack
seeds through this flow — a `product-wiki` wiki's first researched, cited pages — rides the same
review gate as any other change; it is never pushed straight to the default branch.

**A failing check is your work, not the reviewer's.** Declaring a pack is what switched those rules
on, so every finding they now produce belongs to this change — fix it here, in the repo, before the
PR opens. Two things that are *not* fixes: silencing a rule by adding it to `rules`/`accept` in
`.claudinite-checks.json`, and undeclaring the pack to make the findings stop. Both turn a real
signal off on the repo's first exposure to it. If a finding genuinely cannot be satisfied — the pack
demands structure this repo has decided against — that is evidence the pack is **not** the right fit:
drop it from the declaration, say why on the PR, and let the smaller adoption land.

**Never leave the repo red.** Whatever stops you — a check you cannot satisfy, an unanswered
interview question, a scaffold that needs a decision — get the tree green first and open the PR on
what is settled. An incomplete adoption in a green repo is a handoff; an incomplete adoption in a
red one is a bug report against you.
