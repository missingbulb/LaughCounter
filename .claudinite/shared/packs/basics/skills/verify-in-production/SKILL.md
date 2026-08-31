---
name: verify-in-production
description: Decide whether a change that has merged can only be proven in production, and if so file the verification that comes back on its own once it is live. Use immediately after the merge, beside the conversation capture — never before, and not on request.
---

# Verify in production

A change is finished when someone has watched it work. Most changes you can watch **now**, and
that is the rule — this skill is only for the rest: a change whose proof lives somewhere the
repo cannot see yet. You are filing the proof, not doing the work — and the proof itself runs
unattended: an automatic check, end to end, with a person entering
only where no automatic check can exist.

## When it fires: after the merge, never before

**The PR must have merged.** This skill runs as a step of the merge, unasked — `merge-to-main`
calls it once the squash has landed — and at no other moment. Not when the code is written, not
when the PR opens, not while review is in flight.

The reason is that a PR can be **rejected**, and a branch that is still open can be rewritten
under you. Both leave a verification whose premise never reached `main`:

- A **rewritten branch** makes the brief describe a change that no longer exists. #1121 was filed
  against a scope its PR then dropped; the verification was moot before the merge it waited on.
- A **rejected PR** is worse, because the queue cannot tell it from a merge. A blocked item
  releases on its blocker being *closed*, and nothing reads `merged` — so the item goes ready,
  reads an `In-production-when:` that can never become true, pushes `Not-before:` forward by
  `Retry-every:` without comment, and repeats indefinitely. No janitor rule reclaims it: the
  stale-ready sweep cannot see an item sleeping on a future `Not-before`, and the
  stuck-dependency sweep exempts an item whose blockers have closed.

So there is no such thing as filing this early and letting the queue sort it out. Wait for the
merge, then read **what actually landed** — the merged diff, not the branch you remember writing.

## First: does this file anything at all?

Most changes **file nothing.** Run the test in this order and stop at the first answer:

1. **Can you watch it work in this session — now, or after a wait you can sit through?**
   Then do that and file nothing. Not only "did you already": #1460 was filed and then
   hand-verified twelve minutes later, which means the artifact was readable all along and
   the issue was pure overhead. If it becomes readable inside the session you are in,
   waiting for it is cheaper than every mechanism below.
2. **Did a test that ran prove it?** A unit test, a CI job, an executable-requirements or UI
   test covering exactly the behaviour that changed. File nothing — the suite is the mechanism
   that comes back.
3. **Does the change have an observable effect at all?** A comment, a design doc, a README, a
   rename with no behavioural edge, a refactor a passing suite already pins. File nothing.
4. **Otherwise: where does its effect first become observable?** If the answer is a place and a
   moment — a member repo once it converges, a site once it deploys, a session once it reloads
   its rules — that is what you file.

The bar is *could not be watched now*, not *would be nice to double-check*. A verification
filed for a change already covered by a test is a wasted run re-proving what the suite proved.
And the test above only files point assertions: when the merge completes a **larger element** —
one that earned a design doc or a phased tracking issue — the ~week-later review of how the
whole design fared is [production-retrospective](../production-retrospective/SKILL.md)'s
separate call, made beside this one.

## Second: can the RUN read it?

The run is an unattended session on this repository, and its reach is narrower than
yours: **GitHub, through its own tools, in the repositories its routine's scope names**
— and nothing else. There is no browser and no general egress, so a `*.github.io` page,
a live site's `/version.json`, a console, a dashboard and a login-walled report are all
unreadable to it, and so is a repository outside that scope.

So take the read you are about to write into `Verify:` and answer, in one sentence,
*which tool call makes it*. If you cannot name one, the run cannot make it either — and
filing it anyway spends a session rediscovering that wall and then parks
`needs-human-action`, which is the human's-memory outcome this skill exists to avoid.
One executor batch spent five of its seven claimed items exactly that way (#1184, #1253,
#1268, #1288, #1291).

| the read | which form |
|---|---|
| this repo's files, issues, PRs, labels, workflow runs, checks | the automatic form below |
| another repo's, **only** where the routine's scope names it | the automatic form below |
| a web page, a site, a console, a dashboard, a login wall | the human-step form |

**The human-step form** is an ordinary issue, not a queue item: title it the same
`Verify in production: …`, carry `Original-issue:` and attach it as that issue's
sub-issue, and write the body as a checkbox per step — the exact URL to open, what to
look for, what counts as a pass, and what to do if it fails. **No mark, no
`Not-before:`, no `Retry-every:`, no `Model:`**: nothing in it is the queue's, and a
mark would buy only a session that parks. Assign it to whoever owns the release, and say
in your reply that this one needs their eyes because no runner can see the artifact.

## What you file

**A deferred request** — the same ad-hoc lane `/do-later` rides, so the queue does the waiting,
the running and the lifecycle; nothing here adds machinery beside it. One issue, titled
`Verify in production: <the change, in a few words>`, its body the whole brief: the run that
verifies will never see this conversation and may be days away. **Every field a run reads is one
block on the first lines of the description**, ahead of your prose — the same placement
[`/do-later`](../do-later/SKILL.md) files under, and what gives the retry below one place to
rewrite `Not-before:`. Then say what changed and why it could not be watched now.

```
Original-issue: #<the change's issue>
In-production-when: <the concrete artifact to read, and what makes it true>
Verify: <what to observe, and what counts as a pass>
Not-before: <ISO instant just past the expected release>
Retry-every: <how far to push Not-before when not yet live, e.g. 1 day>
Model: sonnet
```

No `Blocked-by:`. You are filing after the merge, so the change's PR has already closed and
there is nothing left to wait on but the release itself.

- **`Original-issue:`** is where a failure lands — the issue the change was done under, which
  the run reopens if the verification fails. Make the verification that issue's **sub-issue**
  too (`mcp__github__sub_issue_write`, method `add`, `issue_number` the original,
  `sub_issue_id` the **id** the create call returned, not its number), so the change it proves
  shows what is still unproven about it — [RULES.md](../../RULES.md)' *Filing an issue that
  belongs under another*, applied where there is no PR left to carry the link.
- **`In-production-when:`** names a thing to *read*, never a duration to wait.
  "`missingbulb/Shepherd`'s `.claudinite-settings.json` stamps `packVersions.tidy-repo` at 8 or
  higher." "Any session started after this
  landed — check the vendored copy under `.claudinite/shared/` carries the new text." A merge
  is not a production condition, neither is elapsed time, and neither is anything the run
  cannot read.
- **`Verify:`** is an assertion with a pass condition, not a topic — and a read the run can
  actually make (the gate above): a file's content, an issue's state, a run's conclusion.
  "Issue #100 on that repo is closed with a comment citing the scheduler runs" beats "check
  tidy-issues works". A `Verify:` naming a person's step does not belong in this form at all —
  that is the human-step form, and it never carries the mark.
- **`Not-before:`** is the queue's own wait field: adoption holds the run until the moment has
  passed. Aim it just past the release you expect — the re-arm covers a miss, so don't pad it.
- **`Retry-every:`** is the extension you are prescribing: when the run finds the change not
  yet live, it re-arms `Not-before:` to **now + `Retry-every:`** — never the old value plus it.
  Size it to the release you wait on — a nightly converge retries daily, a next-session rule in
  minutes.

Then the mark, as `/do-later` applies it: **`task:origin:ad-hoc`**, the one label the scheduler
run adopts. `Model: sonnet` is in the block above because that is the work: reading a live
artifact and judging an assertion against it. Never `Automerge:` — a verification has nothing to
merge. If the mark doesn't exist in the repo yet, say so and leave the issue — it appears on the
next scheduler run.

## Tell the run how to converge

End the body with instructions to the run itself — the issue is its whole brief, and the run
decides nothing: it executes this playbook.

**The transition off this issue is `converge-item.mjs`** — the command your instructions'
converge step names — **and never your own hand.** It reaches no network and needs none: it
reads the item you hand it, plans every side effect, and prints the calls for your own GitHub
tools to make. A session with no route to `api.github.com` runs it exactly like any other;
that is what it is for, so there is nothing here to improvise. **Never write a
`task:status:*` label by hand**: a hand-set `task:status:done` on an issue left open is a pass
recorded nowhere the queue reads, and the done label then hides the item from the leash, so
nothing ever comes back for it (#1220, #1265). If the command refuses, it is telling you this
item is not yours to converge — say so and stop.

1. Read `In-production-when:` against the real artifact. Never infer it from a merge, a green
   run, or elapsed time. If it turns out you cannot read it at all from here, that is
   `--outcome action`, naming the read and who can make it — not a silent walk-away.
2. **Live** → run `Verify:`. Passes: converge `--outcome done`, its `--summary` carrying the
   evidence actually read (the version, the value, the path); the command closes this issue.
   Fails: reopen `Original-issue:` with a comment saying what was asserted, what happened
   instead and where you read it, then converge `--outcome done`, its summary linking that
   comment — the verification did its job by finding the fault, and the fault is now that
   issue's.
3. **Not yet live** → the one branch that converges nothing, because the run is not over: set
   `Not-before:` to **now + `Retry-every:`** — the instant you are
   reading this at, never the old value the field carries — **clear the issue's
   `task:status:*` label** (clearing the status is the whole of the re-ask — the mark stays on
   for life), and leave the issue open. The next scheduler run re-adopts it, and the bumped
   field holds it until the new moment. No comment; the bumped field is the record.

   Measuring from the old value is what #1160 did: the queue releases a sleeping item on the
   first hourly pass past its instant, so by the time a run reads the field it is already
   behind — old + `Retry-every: 1 day` lands in the past again, the item goes ready on the very
   next pass, and a daily retry spends a session an hour.

## Then say what you filed

One line back to the owner: the issue link, what it waits on, and its retry cadence.
