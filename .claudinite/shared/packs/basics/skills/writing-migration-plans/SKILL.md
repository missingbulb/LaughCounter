---
name: writing-migration-plans
description: Where a plan and a design live, and how to order a plan's phases so nothing stalls mid-run — the plan is a tracking issue (never a plan document in the repo), the design doc carries only the end state with rationale and alternatives; front-load the out-of-band setup, write ALL the code including the cleanup and take one approval for the stack, then chain every execution step to the verification of the one before it as a queued continuation, and keep the tracking issue append-only while implementing. Use BEFORE writing any DESIGN.md, migration plan, phased implementation plan, rollout or cutover plan — including the moment you are about to create a docs/<initiative>/ file — and when working through a plan's tracking issue.
---

# Writing migration and implementation plans

A plan's phases are not a narrative of the work; they are a **schedule of who has to be present
when**. Ordering them by topic — "phase 1: the store, phase 2: the workers, phase 3: cutover" —
scatters the moments that need a human across the whole run, and every one of them stops it. Order
them by *what blocks*, and the run ends with a stretch nobody has to attend.

The shape this produces, in one line: **setup, then one approval of everything, then a chain that
runs itself.** All the code is written before the owner is asked for anything — the cleanup and
the destructive tail included — so their attention is spent once; and every step after that
approval is a queued continuation armed on the step before it, so the migration advances without
anyone remembering it exists.

Everything below assumes the change is already agreed: the problem, and that this migration is the
right way to solve it (basics' *Starting any requested change*). The end-state's **shape** —
converging in one forced pass, accepting legacy input at the door, a standing mechanism for
stragglers — is [RULES.md](../../RULES.md)' *Planning a migration*; this skill is the ordering.

## Two deliverables, two homes — and only two

An initiative produces at most one document and one issue, and neither may do the
other's job:

- **The design doc** (`docs/<initiative>/DESIGN.md`, where the project keeps one)
  describes the **end state and its rationale** — what the mechanism is once the
  work is done, and why that shape over the alternatives, with each alternative's
  drawbacks stated. It never carries the previous state as narrative, the requests
  or conversation that led here, owner attributions or opinions, progress, or a
  phase list. The test: a reader who arrives after the migration finishes must
  find nothing to delete. Legacy shapes appear only where the end state itself
  keeps handling them (a decode map, an accepted input) — as mechanism, not as
  history.
- **The migration is work, not a document.** Its plan lives in the tracking issue
  and nowhere else — never a plan or migration document committed to the repo. A
  plan document goes stale the moment work starts and cannot be checked off; the
  issue is checkable, append-only, and dies with the work.

## The three blocks, and where each belongs

Sort every step of the plan into one of three kinds, and let that sort — not the subject matter —
decide the phase it lands in.

**1. Out-of-band setup — before any code changes.** Anything performed outside the repo that a
later step will need: provisioning an environment, creating a session or runner, setting a secret
or variable, granting a permission, flipping a platform setting, registering a webhook. Nearly all
of it is **non-destructive** — it adds a capability that nothing yet consumes, so doing it early
costs nothing and changes no behaviour. Doing it *late* costs the whole run: the plan reaches the
step that reads the secret and stops until someone is available.

Front-load all of it into phase zero, before the first line of code. Write it as its own issue
with a checkbox per step (basics' *Handing over a human-only step*), stating for each what stays
broken while it is off, and written per
[writing-handover-issues](../writing-handover-issues/SKILL.md). And before writing it down, confirm you genuinely cannot do it yourself —
a step handed to a human that you could have taken is the most expensive kind of block there is.

The exception is the genuinely destructive step — deleting the old store, revoking the old
credential, removing the compatibility shim. Those are not setup; they are the migration's tail,
and they belong after the cutover has been observed working — which is **not** a later phase. A
cleanup phase falls due long after the run that would have done it ended, and nothing brings it
back.

**Write its code anyway, now, in the stack** (the next sort), so the owner approves it with
everything else — and make its *merge* a link in the chain below, armed on the cutover being
observed. What must never be deferred is the writing and the approving; what must always be
deferred is the merging.

**2. Review and authorization gates — collapsed into one pass.** Every phase that ships code is a
gate: the owner must read it and approve it before the next phase can start. A plan with four
coding phases has four such waits, and each one is dead time whose length nobody controls.

Write **all** the code first — every phase of it, including the cleanup and the destructive tail —
as a stack of PRs each based on the previous, and put the whole stack in front of the owner
together. The stack keeps the reviewable units small and independent — one concern per PR, as ever
— while costing one arrival of attention rather than four.

*Write* is not *merge*. A PR whose merge must wait on something being observed still gets written,
reviewed and approved in this pass; what waits is its merge, and the thing that performs that
merge is a link in the chain (below), not a person's memory. Say so in that PR's body: what gates
it, and which queued step will merge it.

Approval of the stack is approval of the stack: it does not extend to a fix authored afterwards
(basics' *Acting on an approval to merge, ship or proceed*).

**3. Execution steps — a chain, not a checklist.** Once phase zero has landed the setup and the
approved stack has begun merging, the remaining steps run the migration: force the converge,
backfill the members, watch the cutover, merge the gated PR, retire the shim. If the first two
sorts were done properly there is no *approval* gate among them — but there is almost always a
**wait**, because each step's precondition is the previous step's effect becoming observable
somewhere the repo cannot see yet.

A wait is not a reason to write "then, later, do X". Every one of these steps is filed, at plan
time, as a queued continuation armed on the step before it. See **The chain** below.

That is the test of the plan. **Read the phases in order and mark every point where the run would
have to stop and wait for a person.** Each mark that falls after phase zero and the review pass is
a step that was sorted wrong — or a step that should have been a link in the chain and was written
as a note instead. Move it, chain it, or say in the plan why it genuinely cannot be either.

## The chain

Everything after the approval is a run that arms the next run. The mechanism is the queue's own
ad-hoc lane — the one `/do-later` and `verify-in-production` file into — and nothing here adds
machinery beside it: an ordinary issue, marked for the queue, carrying its own brief.

**File the whole chain when the plan is agreed**, not as each step falls due. One issue per
execution step, each naming the previous in `Blocked-by:`, so the queue does the waiting: a
blocked item is released when its blocker closes, which is exactly "the step before it finished".
Filing the chain up front is what makes it a mechanism rather than a habit — a chain that depends
on each run remembering to file its successor breaks silently the first time a run parks.

The chain's **last link is the plan's retrospective**, filed in the same pass with its brief
written now, while the design's expectations are still in front of you, `Blocked-by:` the final
execution step — so once the migration has lived in production for a while, something comes back
to read whether the design survived contact.
[production-retrospective](../production-retrospective/SKILL.md) owns what that brief answers and
its horizon.

Each link is a **sub-issue of the tracking issue** ([RULES.md](../../RULES.md)' *Filing an issue
that belongs under another*), so the plan and its chain are one hierarchy read two ways rather
than two lists that can disagree. Where a link is a PR's merge rather than a run, that PR's body
closes **the link**, never the tracker: a phase PR carrying `Closes #<tracker>` ends the whole
migration on its first merge.

Each link's body is its whole brief, because the run that picks it up will never see the
conversation that planned it. Four things, and the first two are what make the link *chainable*:

- **What makes this step's world ready** — a thing to *read*, never a duration: a stamp, a file at
  a URL, an API answer. (`verify-in-production` spells this as `In-production-when:`, and a link
  that waits on a release rather than on the previous issue closing rides `Not-before:` +
  `Retry-every:` instead of `Blocked-by:`.)
- **What counts as this step having worked** — the assertion its own successor is waiting on.
  This is the load-bearing half: the chain advances on *validation*, not on the step having run.
- **The playbook**, exact enough to execute without judgment: what to do, and what to do when the
  check fails (comment what was read, leave the issue open — a failed step must not close, because
  closing is what releases the next link).
- **How it ends**: comment the evidence on the tracking issue, then close as completed. That close
  is the trigger for the next link, so it happens last and only on success.

Three hazards worth stating once:

- **Closing is the trigger, and nothing distinguishes a `completed` close from a `not planned`
  one.** Abandoning the migration means closing the *rest* of the chain first, tail-first; closing
  a link to tidy it away releases its successor into a world that is not ready.
- **A link that cannot make its reads must park, not guess.** A rate-limited or scope-blocked
  sweep answers "all clear" in exactly the way a healthy fleet does.
- **A chain is only as visible as its tracking issue.** Every link comments its result there, so
  the plan's checkboxes and the chain's state never have to be reconciled by hand.

## Writing it down

- **The plan is a tracking issue**, and the phases are its checkboxes. Status and remaining work
  live there; a design document, where the project keeps one, carries the mechanism and not the
  progress.
- **Each phase names its exit condition**, observable and stated as a thing that reads back true —
  not "cutover done" but "every member's stamp shows the new ref". A phase whose end is a judgment
  call is a phase that stays open.
- **Nothing closes on a human's memory.** A step you cannot verify now gets a mechanism that comes
  to you — a link in the chain, a scheduled task, an issue something converges (basics' *When
  verifying now is genuinely impossible*). A phase whose closing condition is "check next week" is
  not a phase.
- **Every execution phase names its link.** The checkbox says which issue runs it, so the plan and
  the queue are one thing read two ways rather than two lists that can disagree.
- **Size each step to what it is**, and don't restate in the plan what the design document or the
  linked issue already carries.

## Working through the plan

Once the plan is agreed, the issue body's plan is **append-only**. While implementing, scheduler run its
checkboxes and add below it — a comment, or a new section for what the work turned up — and never
edit, reword, condense or re-order what was already there.

The body is the record of what was agreed, and it is the only copy: an edit overwrites it in place
with nothing left to diff against, so a plan silently rewritten to match what was built reads
afterwards as a plan that was followed. Keeping it fixed is what makes the divergence visible —
and a divergence is the interesting part, not an embarrassment to tidy away.

So when the work shows a phase was wrong, say so **underneath**: what the plan assumed, what turned
out to be true, and what you did instead. If that changes the plan going forward, the new steps are
an addition, appended and dated; the superseded ones stay where they are, marked superseded rather
than deleted.

The exception is a **correction to the plan itself before implementation of it starts** — the owner
saying the plan misreads what they asked for. That is a correction (basics' *Acting on a
correction*): repair the body, since there is no work yet for it to have diverged from.

## Reviewing someone else's plan

Run the same sort over it. The findings worth raising, in order of what they cost:

1. A secret, permission, environment or account created **after** code that depends on it.
2. More than one review gate — two or more phases that each end in "open a PR and wait".
3. Code left unwritten because its phase is "later" — the cleanup and the destructive tail
   above all. Everything the migration will need is written and approved in the one pass; only
   merges and effects are deferred.
4. An execution step written as a note rather than filed as a link — anything phrased "then,
   once X, do Y" with no issue that comes back when X.
5. A chain whose links advance on a step having *run* rather than on its result being *read*.
6. A destructive step scheduled before the replacement has been observed working.
7. A phase with no stated exit condition, or one only a person can judge.
8. A step handed to a human that the agent could have performed itself.
