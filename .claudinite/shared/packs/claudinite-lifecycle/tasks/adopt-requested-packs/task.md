# Adopt the packs this repo's work list asks for

You are here because code-work found at least one open **`add-packs`** issue in **this** repo — the work list a fleet enforcer placed here (its sheepdog `fleet-add-missing-packs` task) before firing this scheduler. Your job: turn that work list into **one reviewed PR on this repo**. The whole of *how* is the [adopt-pack](../../skills/adopt-pack/SKILL.md) skill — declaring, the interview, re-vendoring, scaffolding, getting the checks green, landing. Don't re-derive it here.

## The work list

The open issues labelled `add-packs` in this repo ([`protocol.mjs`](protocol.mjs) is the contract). There are at most two, and the title says what each is:

| title | what it is | what you owe it |
|---|---|---|
| `Add packs: requested for this repo` | a **decision** — the fleet owner named the packs, and the issue's JSON block is the exact declaration entries to write, `config` and `answers` included (the answers are the owner's interview answers, already given) | adopt it verbatim (§2) — never re-litigate whether it was wanted |
| `Add packs: suspected from this repo’s shape` | a **suspicion** — the weekly fleet scan fingerprinted file shapes against packs this repo does not declare | confirm each pack first (§1), adopt what survives, decline the rest with a reason |

An empty work list never reaches you — code-work requests no agent for one. If both issues are open, they are one adoption: one PR covers both.

## 1. Confirm a *suspicion* before acting on it

A fingerprint **suspects**; it does not prove. Per suspected pack:

- Read that pack's `README.md` and its `ruleRoutingGuidance` (in this repo's mount, `.claudinite/shared/packs/<id>/`). Does this repo's actual use match what the pack owns, or did the marker merely happen to be present? A `package.json` in a repo that ships no JavaScript is a fixture, not a Node project.
- Where the issue lists fingerprints under **Not decided from outside**, you can settle them exactly — you have the checkout the fleet's REST sweep did not. Use `localFits` from the enforcer-side task's `fingerprint-fit.mjs` (vendored in the canon clone adopt-pack's re-vendor step fetches) against a context built over this checkout.
- A pack you judge **not** wanted is a real answer: say which and why in a comment on the issue. If every suspected pack is declined, close the issue `not planned` — a standing answer the weekly scan honours rather than re-suggesting.

A suspected pack that asks interview questions the repo cannot answer from its own contents follows adopt-pack's unattended rule: never guess, finish what the question does not gate, and hand off in the open.

## 2. Adopt

Run **adopt-pack** for the confirmed and requested packs. Two things belong to you rather than the skill:

- **On a requested issue, merge the rendered entries verbatim** into `.claudinite-checks.json`'s `packs` — into an entry this repo already carries where one exists, never replacing a `config` this repo already chose. The `answers` are recorded answers; transcribe them, don't re-ask.
- **One PR for the whole work list**, and **link both ways**: the PR body names the issue(s), and you comment the PR link on each. The fleet's weekly sweep closes them on its own once the declaration carries the packs; your comment is what makes the intervening week legible.

## 3. Report

Close out on your work item as usual: the packs adopted with the PR link, the packs declined with the reason, and anything left for a human — an adoption blocked on an unanswerable interview question is exactly that, and naming it is the whole handoff.

## What you must not do

- **Never merge.** This task is ceilinged at `open-pr` and the executor enforces it in code (`verify-outcome.mjs`); merging fails the run.
- **Never declare a pack you did not confirm** (suspected) **or that was not requested**, and never guess an interview answer — see adopt-pack's rule. If you believe a *requested* entry is wrong, say so on the issue and leave it for a human; never quietly adopt something else in its place.
- **Never touch another repo.** The work list is this repo's; the fleet's sweep owns everything cross-repo.
- **Never apply a `task:` label to the work-list issue.** They are the queue's state vocabulary, read by the tick and the executor; the work list is an ordinary issue, not a work item.
