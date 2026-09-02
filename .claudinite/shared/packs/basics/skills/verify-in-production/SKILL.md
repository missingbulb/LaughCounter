---
name: verify-in-production
description: Decide whether a change that has merged can only be proven in production, and if so file the verification that comes back on its own once it is live. Use immediately after the merge, beside the conversation capture — never before, and not on request.
---

# Verify in production

A change is finished when someone has watched it work. Most changes you can watch **now**, and
that is the rule — this skill is only for the rest: a change whose proof lives somewhere the
repo cannot see yet. You are filing the proof, not doing the work — and the proof itself runs
unattended: an automatic check, end to end, that the run can make from this repository.
Where it cannot, the answer is almost always to file nothing and say the change is
unverified; asking a person is a rare exception, and no automatic check existing is not
on its own enough to earn one.

## When it fires: after the merge, never before

**The PR must have merged.** This skill runs as a step of the merge, unasked — `merge-to-main`
calls it once the squash has landed — and at no other moment. Not when the code is written, not
when the PR opens, not while review is in flight.

The reason is that a PR can be **rejected**, and a branch that is still open can be rewritten
under you. Both leave a verification whose premise never reached `main`:

- A **rewritten branch** makes the brief describe a change that no longer exists. (1)
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
   Then do that and file nothing — the bar is "could you", not "did you already". If it
   becomes readable inside the session you are in, waiting for it is cheaper than every
   mechanism below. (2)
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

## Second: which runner can read it? If neither, file nothing

There are two runners, and the artifact's address decides which one a verification
gets — never preference:

- **A public URL** — a Pages site, a deployed config, a published module, a live
  `/version.json` — files the **coded form**: declarative probes an agentless queue
  task (`claudinite-tasks/verify-production`) fetches and judges Action-side, where
  egress exists. No session ever runs, so there is no egress wall to hit — this is
  the lane for exactly the class that used to park. (3)
- **A GitHub read** — an issue's state, a file at HEAD, a workflow run's conclusion —
  files the **agentic form**: an unattended session on this repository, whose reach
  is narrower than yours — **GitHub, through its own tools, in the repositories its
  routine's scope names** — and nothing else. Take the read you are about to write
  into `Verify:` and answer, in one sentence, *which tool call the run makes, in
  which repository*. **Another repo is the standard trap**, because the read looks
  ordinary and the wall is invisible from here — a `Verify:` naming a member repo
  parks minutes after being picked, on a scope denial. (4)
  A cross-repo artifact with a
  public URL — a member's stamp on `raw.githubusercontent.com`, its Pages site — is
  not walled at all: it is a URL, and the coded form reads it.
- **Neither** — a login-walled console, a private dashboard, a repository outside
  scope with no public surface — **file nothing**: say in your reply that the change
  is unverified and what would prove it. That is a filter, not a fork: an unreadable
  artifact is a reason not to file. Filing anyway spends a session rediscovering the
  wall and then parks `needs-human-action`, which is the human's-memory outcome this
  skill exists to avoid. (3)

Where the subject is the **fleet** rather than this repo — every member's stamp, every
member's CI — this queue is the wrong runner for it whatever you file. It belongs to a
routine that holds fleet scope, if the project has one, and to nobody otherwise.

**Asking a person is the rare exception**, not the fallback. The bar is not "no
automatic check exists" — most changes clear that and still get nothing. It is that a
silent failure here would be **costly**, and you would be willing to interrupt the
person today to have them look. If you would not, the change goes unverified and you say
so. When it does clear that bar, file an ordinary issue — never a queue item: title it
the same `Verify in production: …`, carry `Original-issue:` and attach it as that
issue's sub-issue, and write the body per
[writing-handover-issues](../writing-handover-issues/SKILL.md) — somebody else runs it,
so the checklist is the artifact. **No mark, no
`Not-before:`, no `Retry-every:`, no `Model:`**: nothing in it is the queue's, and a mark
would buy only a session that parks. Assign it to whoever owns the release, and say in
your reply that you are spending their attention and why it was worth it.

## What you file

**A deferred request** — the same ad-hoc lane `/do-later` rides, so the queue does the waiting,
the running and the lifecycle; nothing here adds machinery beside it. One issue, titled
`Verify in production: <the change, in a few words>`, its body the whole brief: the run that
verifies will never see this conversation and may be days away. **Every field a run reads is one
block on the first lines of the description**, ahead of your prose — the same placement
[`/do-later`](../do-later/SKILL.md) files under, and what gives the retry below one place to
rewrite `Not-before:`. Then say what changed and why it could not be watched now.

### The coded form — for a URL-readable artifact

```
Original-issue: #<the change's issue>
Task: claudinite-tasks/verify-production
Live-probe: <url> :: <assertion that becomes true when the release lands>
Verify-probe: <url> :: <the assertion being verified>
Retry-every: <how often to re-probe while not yet live, e.g. 6 hours>
```

The probes are the whole check, executed in code by the task the `Task:` line names —
no session, no `Model:`. `Live-probe:` is `In-production-when:` made executable and
`Verify-probe:` is `Verify:`; both classes are required, repeat either line for more
probes, and the assertion grammar (`status`, `contains`, `matches`, the `json` value
ops) is documented at its one home,
[`probes.mjs`](../../../claudinite-tasks/tasks/verify-production/probes.mjs). A
liveness probe failing re-arms the item by `Retry-every:`; a verify probe failing
against a live release reopens `Original-issue:` with what was asserted and what was
read; all passing closes the item with that evidence. No `Not-before:` is needed: a
coded run costs seconds, so probing from the moment of filing is the point, not a
waste — see the watch-it-fail step below.

### The agentic form — for a GitHub read

```
Original-issue: #<the change's issue>
In-production-when: <the concrete artifact to read, and what makes it true>
Verify: <what to observe, and what counts as a pass>
Not-before: <ISO instant just past the expected release>
Retry-every: <how far to push Not-before when not yet live, e.g. 1 day>
Model: sonnet
```

In either form, no `Blocked-by:`. You are filing after the merge, so the change's PR has
already closed and there is nothing left to wait on but the release itself.

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
  that is the rare human step above, an ordinary issue that never carries the mark.
- **`Not-before:`** is the queue's own wait field: adoption holds the run until the moment has
  passed. Aim it just past the release you expect — the re-arm covers a miss, so don't pad it.
- **`Retry-every:`** is the extension you are prescribing: when the run finds the change not
  yet live, it re-arms `Not-before:` to **now + `Retry-every:`** — never the old value plus it.
  Size it to the release you wait on — a nightly converge retries daily, a next-session rule in
  minutes.

Then the mark, as `/do-later` applies it: **`task:origin:ad-hoc`**, the one label the scheduler
run adopts — both forms alike. The agentic form's `Model: sonnet` is in its block because that
is the work: reading a live artifact and judging an assertion against it; the coded form names
no model, because nothing runs but code. Never `Automerge:` — a verification has nothing to
merge. If the mark doesn't exist in the repo yet, say so and leave the issue — it appears on the
next scheduler run.

## Tell the agentic run how to converge

The coded form needs none of this: its verdicts — requeue, pass, reopen — are the machinery's,
so its body ends with your prose and the playbook below would only be read as instructions by
something that takes none.

For the agentic form, end the body with instructions to the run itself — the issue is its whole
brief, and the run decides nothing: it executes this playbook.

**The transition off this issue is `converge-item.mjs`** — the command your instructions'
converge step names — **and never your own hand.** It reaches no network and needs none: it
reads the item you hand it, plans every side effect, and prints the calls for your own GitHub
tools to make. A session with no route to `api.github.com` runs it exactly like any other;
that is what it is for, so there is nothing here to improvise. **Never write a
`task:status:*` label by hand**: a hand-set `task:status:done` on an issue left open is a pass
recorded nowhere the queue reads, and the done label then hides the item from the leash, so
nothing ever comes back for it. (5)
If the command refuses, it is telling you this item is not yours to converge — say so and stop.

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

   Measure from the instant you read, because the queue releases a sleeping item on the
   first hourly pass past its moment, so by the time a run reads the field it is already
   behind — old + `Retry-every: 1 day` lands in the past again, the item goes ready on the
   very next pass, and a daily retry spends a session an hour. (6)

## Then watch it fail, and say what you filed

A coded verification runs for seconds, so its first execution is not left to faith: dispatch
the scheduler workflow (its `workflow_dispatch`) and
watch the first run report **not yet live** — proof the probes execute and fail for the right
reason instead of passing vacuously;
the same item then flips on its own once the release lands. A first run that *passes* before
the release you expected deserves a hard look, because a probe that cannot fail proves
nothing. The agentic form sleeps until its `Not-before:` and has no cheap forced run; filing
it correctly is the watch.

One line back to the owner: the issue link, what it waits on, and its retry cadence.
