# Update — the apply stage

The deterministic half already ran. Preprocessing converged this repo's mount to the
canon's current engine and pack versions, ran the version-ranged migrations, gated the
result on the converged tree's own `selftest --strict`, and opened the update PR. The
work item names the branch and says which packs moved.

**You are here for one of three reasons**, and the issue says which:

- **Withheld workflow files** — content the deterministic half already decided but its
  Action token is refused for. Nothing here needs judgment; you are the credential.
- **A pack's updated rules have met content this repo authored** and the canon has never
  seen. This is the half that needs judgment, and it is all of the judgment there is.
- **The converge wrote files this repo's own tests can see** — engine code, a config
  file, a source file a migration rewrote. Nothing has run this repo's own test suite
  against those writes.

## 1. Read why you are here

The item's **Why the agent is here** section names the terminal and the packs
whose versions moved. That is binding scope — do not widen it.

## 2. Deliver the withheld workflow files

Only if the item's reason names them. A file under `.claudinite/pending-workflows/` is
content the deterministic half already computed and decided; it sits there because the
Action token that pushed the branch may not write under `.github/workflows/` and GitHub
rejects the WHOLE ref for trying, so putting it in the pushed tree would have failed the
entire update. You hold a credential that may write there. That is the only reason this
step is yours.

For each staged file: move `.claudinite/pending-workflows/<name>` to
`.github/workflows/<name>`, and leave the staging directory empty.

**Do not edit the content, and do not judge it.** It is what the canon computed for this
member, secrets and all; a session rewriting it is a second author of a file that has
exactly one. If the move is not obviously right — the branch carries a staged file the
item's reason does not name, or the destination already differs in a way you cannot
explain — that is the case for §6, not for improvising.

## 3. Apply the new rules

Only if the issue's reason names a migration record — it names them by path, e.g.
`packs/basics/migrations/2026-08-13-something`. **Read that record** at
`.claudinite/shared/<path>/migration.mjs`: its `applyStage.instructions` say what its
author wanted done, in their words, and are the specific half of this section. The
record is on the branch you were given because the update that raised it vendored it
there. A record the issue names but the branch does not carry is a park
(§6) — guessing at what its author wanted is worse than reporting it missing.

Then, on that branch:

- Bring this repo's own content in line with the updated pack rules, and repair the
  tests those rules break.
- Nothing outside that scope. No new features, no unrelated tidy-ups, no rewriting a
  member-authored local pack beyond what the new rules require.

## 4. Run this repo's tests, and repair what the update broke

Always — whichever reason brought you here. Nothing has run this repository's own test
suite against the branch.

Run it the way this repository runs it, read out of its own docs and config rather
than guessed at. A repo with no suite has nothing to run here; say so and move on.

A failure is yours to repair **only where this cycle's writes caused it**. The item's
reason names the files the converge wrote that a test could see; start from those, and
from the record named in §3 where there is one.

- A test that broke because the new rules changed what this repo should do — repair the
  repo's content, as §3 already says.
- A test that broke because it asserted over something the mount moved — repair the
  test.
- A failure this cycle did not cause — it fails the same way on the base branch — is
  **not** yours. Say so in the comment §6 asks for, name the failing test, and leave it:
  a PR that quietly fixes something else is a PR nobody can review. Prove it rather than
  assume it, by running that test against the base branch.

Never skip, disable or `skip`-mark a test to reach green. A repair nobody can explain is
the §6 park, not a smaller problem.

## 5. Verify the executor routine

The one check no Action can make. This repo's executor routine is fired by an API
call to the endpoint its config names, and it is not a GitHub artifact — only a
session can see it. Confirm it exists and that its whole stored prompt is the one
line pointing at the mounted queue instructions
(`.claudinite/shared/packs/claudinite-tasks/queue/instructions.md`): everything a task
session does comes from that file, so a prompt carrying instructions of its own is
behavior nobody reviews. Report what you found either way.

## 6. End green, or park

Run this repo's checks, and its tests (§4). Green: push to the branch, then hand the
PR to the shared delivery procedure — `deliver-pr.md`, at the root of the claudinite-tasks pack
(`.claudinite/shared/packs/claudinite-tasks/deliver-pr.md`; the canon runs it from
`packs/claudinite-tasks/`) — and do what it says. Nothing else will land this PR:
the deterministic half arms auto-merge only on a `merge` terminal, and yours was
`apply-stage`, so it sits unarmed until you deliver it.

Not green, or a repair you are not sure of: leave the PR open, label
it `task:status:needs-human-decision`, and say in one comment what is unresolved. A withheld workflow you did
not deliver is "not green" — it stays owed, and the next cycle will stage it again.

**Why the delivery is yours to run rather than left for later.** An unmerged PR is not
lost — the next cycle picks it back up. But `update` is a **daily** task, so "the next
cycle" is up to a day away, and until then a workflow you moved into
`.github/workflows/` on the branch is not in `.github/workflows/` on `main`. That
standing ~24h offset between a run's output and the member's `main` is the exact defect
`landDelivery` was written to close for the deterministic half (#649,
`packs/claudinite-tasks/land-pr.mjs`): *the evidence that settles it does not take a day to
arrive*. The same reasoning binds here — the only difference is that you hold the
credential, so you are the one who acts on it.

Every non-green end looks the same here, and that is the point — a repair nobody
verified is not a smaller problem than a red check, it is the same problem with less
evidence.
