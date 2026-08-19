---
name: single-issue-triage
description: Triage one open issue and take the first applicable action — close-if-implemented, needs-decision, blocked, quick-win, or leave. Use when acting on a single issue; "implemented in main" must be verified against main's current content and the default is to comment, not close (e.g. the tidy-repo pack's tidy-issues task hands you issues to triage).
---

# Single-issue triage

Triage **one** open issue and take the **first** applicable action. This **acts** — but every action
defaults to the reversible option when the check is inconclusive.

- **Already implemented in `main`** → **close** (`completed`) + a one-line comment citing where it
  landed.
- **Conflicts with a current guideline** → label `needs-decision` + a comment naming the conflict.
- **Blocked by another issue** → label `blocked` + a comment `blocked by #N`.
- **Small and quick to do** → label `quick-win` + a comment scoping it.
- **Else** → leave it.

**"Implemented in `main`" means the issue's actual ask is true of `main`'s content _now_** — confirm
it there and cite it. **Never** infer it from a linked PR merging or the issue merely looking done. If
you can't point to it, **comment, don't close.** Create a label if it's missing. Return `{ action,
note }` (action one of closed/needs-decision/blocked/quick-win/left/unchanged).

## Never re-post a verdict you already posted

A triage comment updates the issue, and an updated issue is the next window's touched-issue
trigger — so a comment that only restates the last one wakes this task again tomorrow, and again
the day after. The verdict is the news; re-deriving it is not.

Before writing anything, read the issue's comments and find the most recent one this task posted
— by its marker, or, on an issue triaged before the marker existed, by its wording. If the action
you are about to take is the one that comment already announced, **post nothing and change nothing**
(a label already on the issue included) and return `{ action: 'unchanged', note: '<action> since
<its date>' }`. Closing is never a repeat: it changes the issue's state and ends the sequence.

End every comment you post with this marker, alone on the last line:

```
<!-- claudinite:tidy-issues verdict=<action> -->
```
