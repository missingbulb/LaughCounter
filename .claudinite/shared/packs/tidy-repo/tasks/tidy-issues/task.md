# tidy-issues worker

The **acting** half of the repo tidy-up: triage the issues in scope, then record what you did. GitHub
access is **MCP-only** (`mcp__github__*`).

**Your scope.** The run's Context lists the issues that moved in the window — always in scope. Then ask
one question: **did the default branch move substantively in the window?** If it did, widen to **every
open issue**, because a real change to `main` can have implemented or invalidated an issue nobody
touched. If it did not, the Context list is the whole scope: re-reading untouched issues against an
unchanged `main` reaches last run's verdict again. Never widen further than that.

**Claudinite's own issues are not project work**, whichever way you got here: an issue wearing a
`task:`-prefixed label is a scheduler work item, and neither triggers a run nor enters its scope.

This task writes **issues only** (its triage actions and its own tracker). It never opens, closes, merges,
or comments on a PR — that dimension belongs to `tidy-prs`, which is assess-only.

## 1. Triage the issues in scope

[single-issue-triage](../../skills/single-issue-triage/SKILL.md) is the method, and one reading of it
governs every verdict here. The skill owns the action ladder and the safeguards: "implemented in `main`"
means the issue's actual ask is true of `main`'s content **now** — verified there and cited, never
inferred — and when the check is inconclusive it **comments, doesn't close** — and an issue whose verdict
is the one the skill already posted there returns `unchanged`, written to nowhere. Collect what each
triage did.

**Work the scope in your own context**, straight down the list. **Never a subagent per issue**: each one
re-reads the skill and re-derives what `main` holds to return a verdict that is usually `left` or
`unchanged`, so the fan-out costs more than everything it decides.

Fan out only when the scope is genuinely too large for one context, and then **by group, never by
issue** — sort the scope into a handful of groups whose members share what the verification has to read
(the same area of `main`, the same subsystem, the same one-line ask), and hand each group to **one**
subagent that triages all of it and returns one line per issue: `#N — <action> — <note>`. A few
subagents holding many issues each; never one holding one.

**The triage is not the run** — step 2 still has to happen, and **the run bound covers everything you
dispatch**: time spent in children is time on the same clock. Budget for step 2 before dispatching
anything. A partial triage that is recorded is a complete run; a full one that returns past the bound
records nothing, and those issues come back tomorrow anyway.

## 2. Reconcile this task's tracker

**Only a run that changed something reaches the tracker.** What counts is a triage action actually taken —
an issue closed, a comment posted — or something this run leaves for a human. `left` and
`unchanged` are not actions. A run that worked its whole Context list and took no action has
**nothing to record**: leave the tracker exactly as found, no body rewrite and no comment, and
create none if it doesn't exist. The scan itself is not news.

One standing tracker issue per repo, titled exactly `Claudinite tracker: Tidy Issues` — found by that
**exact title, never a fuzzy match**; create it **already closed** when there is something to record and it
is absent — creation always lands an issue open and ignores a `state: closed` argument, so create it and
close it in a second call (never a fresh issue per run, never a bare number that can dangle). Each dimension
keeps its **own** tracker, so the two tasks never race to rewrite one body.

Touch it two ways on a run that has something to record:

- **Rewrite the issue body** to today's **dated** snapshot: the actions taken this run and anything left
  for a human. The body is the live picture — it replaces yesterday's, it doesn't accumulate.
- **Add a dated comment** with today's status, so the body's snapshots leave a per-run trail.

Keep both short. **Never open, close, or reopen the tracker** — its state carries no meaning (the body is
the live picture; the state is just however it was created).

## 3. Retire the legacy tracker (transitional, one line of work)

Repos tidied before the split carry a single combined tracker titled exactly `Claudinite tracker: Repo
Tidy`. If it exists and its body doesn't already say so, rewrite the body to one line pointing at the
per-dimension trackers (`Tidy Issues`, `Tidy PRs`) and stop there — nothing else to do on it, and never
open, close, or reopen it. Already pointing at them ⇒ skip. Absent ⇒ skip; never create it.

`model: sonnet` — the implemented-in-`main` call is judgment; the reconcile is mechanical aggregation.
