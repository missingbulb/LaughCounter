# Update — the apply stage

The deterministic half already ran. Preprocessing converged this repo's mount to the
canon's current engine and pack versions, ran the version-ranged migrations, gated the
result on the converged tree's own `selftest --strict`, and opened the update PR. The
dispatch issue names the branch and says which packs moved.

**You are here for one of two reasons**, and the issue says which:

- **Withheld workflow files** — content the deterministic half already decided but its
  Action token is refused for. Nothing here needs judgment; you are the credential.
- **A pack's updated rules have met content this repo authored** and the canon has never
  seen. This is the half that needs judgment, and it is all of the judgment there is.

## 1. Read why you are here

The dispatch issue's **Why the agent is here** section names the terminal and the packs
whose versions moved. That is binding scope — do not widen it.

## 2. Deliver any withheld workflow files

GitHub never lets an Action's `GITHUB_TOKEN` write under `.github/workflows/`, and the
refusal rejects the whole push — so the update flow stages that content instead of
committing it where it belongs. Anything staged is already on the branch, already in the
PR's diff, and already correct.

If `.claudinite/pending-workflows/` has files in it, then for each one:

- Move it to `.github/workflows/` under the same name — **byte for byte**.
- Delete the staged copy.

Do not reformat it, do not reorder it, do not reconcile it against what the file used to
say. It is a converged artifact, not a draft: the cron minute is a hash of this repo's
full name and the `env:` block is the union of every scheduled task's `required_secrets`,
so an "improvement" here silently changes when this repo runs or which secrets its tasks
can see. A staged file that looks wrong is a `needs-human` end (§5), reported with what
looked wrong — that is a canon bug, and editing it here would hide it while leaving every
other member broken.

An empty or absent `.claudinite/pending-workflows/` means there is nothing owed. Do not
create it, and never move a file INTO it.

## 3. Apply the new rules

Only if the issue's reason names a migration record — it names them by path, e.g.
`packs/basics/migrations/2026-08-13-something`. **Read that record** at
`.claudinite/shared/<path>/migration.mjs`: its `applyStage.instructions` say what its
author wanted done, in their words, and are the specific half of this section. The
record is on the branch you were given because the update that raised it vendored it
there. A record the issue names but the branch does not carry is a `needs-human` end
(§5) — guessing at what its author wanted is worse than reporting it missing.

Then, on that branch:

- Bring this repo's own content in line with the updated pack rules, and repair the
  tests those rules break.
- Nothing outside that scope. No new features, no unrelated tidy-ups, no rewriting a
  member-authored local pack beyond what the new rules require.

## 4. Verify the executor routine

The one check no Action can make. This repo's executor routine fires on the
`ready-for-agent` label, and it is not a GitHub artifact — only a session can see it.
Confirm it exists and that its prompt points at the mounted executor instructions
(`.claudinite/shared/engine/scheduler/executor.md`). Report what you found either way.

## 5. End green, or end at `needs-human`

Run this repo's checks. Green: push to the branch and let the PR land per this repo's
delivery setting. Not green, or a repair you are not sure of: leave the PR open, label
it `needs-human`, and say in one comment what is unresolved. A withheld workflow you did
not deliver is "not green" — it stays owed, and the next cycle will stage it again.

Every non-green end looks the same here, and that is the point — a repair nobody
verified is not a smaller problem than a red check, it is the same problem with less
evidence.
