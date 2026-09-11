# update

## Why the declaration reads as it does

Carried over from the declaration's comments when it became `task.json`.

basics task: update — the versioned engine/pack update flows, run by a repo on
itself (#768 — see the versioned-updates design there). The successor to
`baselining`, and since Phase 5 deleted that, the only thing that maintains a
member's mount: there is no mechanism flag left to consult, and the block that
held one is gone (#1252).

Two stages, like baselining's. The DETERMINISTIC flows are `code_work`
(worker.mjs): they converge the mount, run the version-ranged migrations, gate on
the converged tree's self-test, open the PR, and act on the terminal. The AGENT
stage runs only when the pack flow's apply stage is needed: the pack's new rules
meeting member-authored content the canon has never seen, a workflow file the
Action token could not deliver, or a cycle whose writes this repository's own
tests could see — the self-test the deterministic half gates on is Claudinite's
probes, never the repo's suite, so a session is what runs that suite and repairs
what the update broke.

Its `automerge` is the written-out prediction of that shape: the mount, the two
config files, `.github/workflows/` (what the apply stage delivers out of the
staging directory) and the test tree (what its repairs touch). A migration that
rewrites a repo-owned source file lands outside the prediction and parks the PR
for a person, which is the review this task is willing to pay for.

A cycle that cannot land its pull request REWRITES that pull request next time
rather than opening the next in a line of obsolete ones: the converge is a full
recompute from the base, so the open one's branch is simply force-pushed to this
cycle's answer, its title and body with it. The one thing that is not rewritten is
a branch already carrying this converge — pushing an identical tree would give the
pull request a new head and discard the checks that had already run on it, which
on a member waiting for slow CI is the difference between eventually landing and
never landing.

The mount takes two terms rather than one, and the pair is not redundant.
`claudinite-shared-packs` is the declared rule carrying the grant for the
canon-authored policy files a re-vendor replaces; the inline `under:.claudinite`
beside it covers the rest of the mount that rule does not reach — the withheld
workflows' staging directory, and a member's own local packs where a record
normalizes one. The test tree is named by kind rather than by folder because a
member's tests live wherever that member puts them.

it standalone — the whole contract lives in this default export.
The input is the CANON, which moves when this repo does not — so no repo-side
condition may gate it, and a silent repo is exactly when the mount most needs
the pass. A repo with no vendored mount to update is a fact adoption settled,
not a nightly question: such a repo names `claudinite-lifecycle/update` in its
`taskScheduler.disabledTasks`.
