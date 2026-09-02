# tidy-prs worker

The **assess-only** PR half of the repo tidy-up: a weekly pass over every open PR — run only when a PR
actually moved in the window — then record the picture. GitHub access is **MCP-only**
(`mcp__github__*`).

**Your scope is every OPEN PR**, not only the ones that moved: movement is what makes the picture worth
re-deriving, and the picture is of the whole open set. The Context names the PRs that moved, which is
where the change since last week is. A **merged** PR is not in scope at all — you cannot recommend
closing what has landed.

This dimension is read-only: **never close, merge, comment on, or push to a PR.** You recommend; a human
acts. The only thing you write is this task's own tracker issue.

## 1. Assess each PR

For each open PR, run the [single-pr-status](../../skills/single-pr-status/SKILL.md) skill
for its verdict — judged by its commits and diff, never its title. Collect:

- one line each for the PRs that should **stay open** (`#N — why it's live`);
- the rest collapsed into one `Closeable: #a, #b — merged/superseded/stale` line.

## 2. Reconcile this task's tracker

**Only a run whose picture changed reaches the tracker.** Read the tracker's current body first and compare:
a PR entering or leaving the list, or a verdict that flipped, is news. Verdicts identical to the ones already
in the body are **nothing to record** — leave the body, post no comment, and create no tracker if none
exists. Re-deriving last week's picture is a scan, not a change.

One standing tracker issue per repo, titled exactly `Claudinite tracker: Tidy PRs` — found by that **exact
title, never a fuzzy match**; create it **already closed** when there is something to record and it is absent
— creation always lands an issue open and ignores a `state: closed` argument, so create it and close it in a
second call (never a fresh issue per run, never a bare number that can dangle). Each dimension keeps its
**own** tracker, so the two tasks never race to rewrite one body.

Touch it two ways on a run that has something to record:

- **Rewrite the issue body** to today's **dated** snapshot: the stay-open PRs with their reasons, and the
  closeable ones. The body is the live picture — it replaces last week's, it doesn't accumulate.
- **Add a dated comment** with today's status, so the body's snapshots leave a per-run trail.

Keep both short. **Never open, close, or reopen the tracker** — its state carries no meaning. The tracker
only *records* the recommendations; nothing here acts on a PR.

`model: sonnet` — superseded / already-in-`main` are judgment calls; the reconcile is mechanical aggregation.
