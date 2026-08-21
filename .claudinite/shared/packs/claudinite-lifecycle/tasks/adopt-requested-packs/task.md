# Adopt the packs this repo's work list asks for

**Your work item IS the work list** — an `add-packs` issue a fleet enforcer placed in **this** repo (its claudinite-fleet-sheepdog `fleet-add-missing-packs` task) and marked for the queue, which this repo's own scheduler run then adopted. Its body is the ask; the machine block at the bottom is the machinery's and not part of it. Your job: turn that work list into **one reviewed PR on this repo**. The whole of *how* is the [adopt-pack](../../skills/adopt-pack/SKILL.md) skill — declaring, the interview, re-vendoring, scaffolding, getting the checks green, landing. Don't re-derive it here.

## The work list

The issue you are on ([`protocol.mjs`](protocol.mjs) is the contract). There are two kinds, and the title says which you have:

| title | what it is | what you owe it |
|---|---|---|
| `Add packs: requested for this repo` | a **decision** — the fleet owner named the packs, and the issue's JSON block is the exact declaration entries to write, `config` and `answers` included (the answers are the owner's interview answers, already given) | adopt it verbatim (§2) — never re-litigate whether it was wanted |
| `Add packs: suspected from this repo’s shape` | a **suspicion** — the weekly fleet scan fingerprinted file shapes against packs this repo does not declare | confirm each pack first (§1), adopt what survives, decline the rest with a reason |

If your item is a `[claudinite-work]` issue rather than a work list itself, it was filed before this fold: the work lists are then this repo's open `add-packs` issues, all of them, in one PR. Everything below reads the same either way.

An empty work list never reaches you: an item exists only because an issue was marked. A repo with **both** kinds open gets **two runs**, one per issue, and the second waits on the first (the enforcer names it in `Blocked-by:`) — so adopt what your own issue asks for and leave the other list to its own run.

## 1. Confirm a *suspicion* before acting on it

A fingerprint **suspects**; it does not prove. Per suspected pack:

- Read that pack's `README.md` and its `ruleRoutingGuidance` (in this repo's mount, `.claudinite/shared/packs/<id>/`). Does this repo's actual use match what the pack owns, or did the marker merely happen to be present? A `package.json` in a repo that ships no JavaScript is a fixture, not a Node project.
- Where the issue lists fingerprints under **Not decided from outside**, you can settle them exactly — you have the checkout the fleet's REST sweep did not. Use `localFits` from the enforcer-side task's `fingerprint-fit.mjs` (vendored in the canon clone adopt-pack's re-vendor step fetches) against a context built over this checkout.
- A pack you judge **not** wanted is a real answer: say which and why in a comment on the issue. If every suspected pack is declined, close the issue `not planned` — a standing answer the weekly scan honours rather than re-suggesting.

A suspected pack that asks interview questions the repo cannot answer from its own contents follows adopt-pack's unattended rule: never guess, finish what the question does not gate, and hand off in the open.

## 2. Adopt

Run **adopt-pack** for the confirmed and requested packs. Two things belong to you rather than the skill:

- **On a requested issue, merge the rendered entries verbatim** into `.claudinite-checks.json`'s `packs` — into an entry this repo already carries where one exists, never replacing a `config` this repo already chose. The `answers` are recorded answers; transcribe them, don't re-ask.
- **One PR for this work list**, and **link both ways**: the PR body names this issue, and you comment the PR link on it. The fleet's weekly sweep closes it on its own once the declaration carries the packs; your comment is what makes the intervening week legible.

## 3. Report

Converge as usual — and note that your item is somebody's issue, so the converge command leaves it **open** with its terminal status: the packs adopted with the PR link, the packs declined with the reason, and anything left for a human. An adoption blocked on an unanswerable interview question is exactly that, and naming it is the whole handoff.

## What you must not do

- **Never merge.** Open the PR and leave it for review.
- **Never declare a pack you did not confirm** (suspected) **or that was not requested**, and never guess an interview answer — see adopt-pack's rule. If you believe a *requested* entry is wrong, say so on the issue and leave it for a human; never quietly adopt something else in its place.
- **Never touch another repo.** The work list is this repo's; the fleet's sweep owns everything cross-repo.
- **Never apply a `task:` label by hand.** The work list *is* a work item now, so it wears the queue's own status — but only the converge command writes it. A status applied by hand is a state nobody's run is in.
- **Never close the issue.** It is somebody's, and its terminal status stands on it open; the fleet's weekly sweep closes it once the declaration carries the packs.
