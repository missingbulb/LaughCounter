# Update — the apply stage

The deterministic half already ran. Preprocessing converged this repo's mount to the
canon's current engine and pack versions, ran the version-ranged migrations, gated the
result on the converged tree's own `selftest --strict`, and opened the update PR. The
dispatch issue names the branch and says which packs moved.

**You are here for one reason**: a pack's updated rules have met content this repo
authored and the canon has never seen. Nothing else in this flow needs judgment, and
nothing else is yours.

## 1. Read why you are here

The dispatch issue's **Why the agent is here** section names the terminal and the packs
whose versions moved. That is binding scope — do not widen it.

## 2. Apply the new rules

On the branch the issue names:

- Bring this repo's own content in line with the updated pack rules, and repair the
  tests those rules break.
- Nothing outside that scope. No new features, no unrelated tidy-ups, no rewriting a
  member-authored local pack beyond what the new rules require.

## 3. Verify the executor routine

The one check no Action can make. This repo's executor routine fires on the
`ready-for-agent` label, and it is not a GitHub artifact — only a session can see it.
Confirm it exists and that its prompt points at the mounted executor instructions
(`.claudinite/shared/engine/scheduler/executor.md`). Report what you found either way.

## 4. End green, or end at `needs-human`

Run this repo's checks. Green: push to the branch and let the PR land per this repo's
delivery setting. Not green, or a repair you are not sure of: leave the PR open, label
it `needs-human`, and say in one comment what is unresolved.

Every non-green end looks the same here, and that is the point — a repair nobody
verified is not a smaller problem than a red check, it is the same problem with less
evidence.
