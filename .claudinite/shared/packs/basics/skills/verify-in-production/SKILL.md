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

1. **Did you watch it work in this session?** Then it is proven. File nothing.
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
- **`In-production-when:`** names a thing to *read*, never a duration to wait. "`missingbulb/Shepherd`'s
  `.claudinite-settings.json` stamps `packVersions.tidy-repo` at 8 or higher." "The live site's
  `/version.json` reports a version past 4.2.0." "Any session started after this landed — check
  the vendored copy under `.claudinite/shared/` carries the new text." A merge is not a
  production condition, and neither is elapsed time.
- **`Verify:`** is an assertion with a pass condition, not a topic — and a read an **unattended
  run can make**: an API response, a file at a URL, an issue's state. "Issue #100 on that repo
  is closed with a comment citing the scheduler runs" beats "check tidy-issues works". Only where no
  automatic check can exist may `Verify:` name a person's step, spelled out exactly.
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

1. Read `In-production-when:` against the real artifact. Never infer it from a merge, a green
   run, or elapsed time.
2. **Live** → run `Verify:`. Passes: comment the evidence actually read (the version, the value,
   the URL) and close this issue as completed. Fails: reopen `Original-issue:` with a comment
   saying what was asserted, what happened instead and where you read it; comment here linking
   that; close this issue as completed — the verification did its job by finding the fault.
3. **Not yet live** → set `Not-before:` to **now + `Retry-every:`** — the instant you are
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
