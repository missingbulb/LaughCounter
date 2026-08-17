---
name: writing-migration-plans
description: How to order the phases of an implementation or migration plan so nothing stalls mid-run — front-load the out-of-band setup, collapse the review gates into one stacked-PR pass, leave only executable steps — and how to keep its tracking issue append-only while implementing. Use when writing or reviewing a migration plan or a phased implementation plan, and when working through one's tracking issue.
---

# Writing migration and implementation plans

A plan's phases are not a narrative of the work; they are a **schedule of who has to be present
when**. Ordering them by topic — "phase 1: the store, phase 2: the workers, phase 3: cutover" —
scatters the moments that need a human across the whole run, and every one of them stops it. Order
them by *what blocks*, and the run ends with a stretch nobody has to attend.

Everything below assumes the change is already agreed: the problem, and that this migration is the
right way to solve it (basics' *Starting any requested change*). The end-state's **shape** —
converging in one forced pass, accepting legacy input at the door, a standing mechanism for
stragglers — is [RULES.md](../../RULES.md)' *Planning a migration*; this skill is the ordering.

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
broken while it is off. And before writing it down, confirm you genuinely cannot do it yourself —
a step handed to a human that you could have taken is the most expensive kind of block there is.

The exception is the genuinely destructive step — deleting the old store, revoking the old
credential, removing the compatibility shim. Those are not setup; they are the migration's tail,
and they belong after the cutover has been observed working.

**2. Review and authorization gates — collapsed into one pass.** Every phase that ships code is a
gate: the owner must read it and approve it before the next phase can start. A plan with four
coding phases has four such waits, and each one is dead time whose length nobody controls.

Write **all** the code first, as a stack of PRs each based on the previous, and put the whole
stack in front of the owner together. The stack keeps the reviewable units small and independent —
one concern per PR, as ever — while costing one arrival of attention rather than four. Merge it
base-first once approved.

Approval of the stack is approval of the stack: it does not extend to a fix authored afterwards
(basics' *Acting on an approval to merge, ship or proceed*).

**3. Execution steps — whatever is left.** Once phase zero has landed the setup and the stack has
merged, the remaining steps run the migration: force the converge, backfill the members, watch the
cutover, retire the shim. If the first two sorts were done properly there is no gate among them —
they can be run at will, in one sitting, by whoever is at the keyboard.

That is the test of the plan. **Read the phases in order and mark every point where the run would
have to stop and wait for a person.** Each mark that falls after phase zero and the review pass is
a step that was sorted wrong. Move it, or say in the plan why it genuinely cannot move.

## Writing it down

- **The plan is a tracking issue**, and the phases are its checkboxes. Status and remaining work
  live there; a design document, where the project keeps one, carries the mechanism and not the
  progress.
- **Each phase names its exit condition**, observable and stated as a thing that reads back true —
  not "cutover done" but "every member's stamp shows the new ref". A phase whose end is a judgment
  call is a phase that stays open.
- **Nothing closes on a human's memory.** A step you cannot verify now gets a mechanism that comes
  to you — a scheduled task, a watched PR, an issue something converges (basics' *When verifying now
  is genuinely impossible*). A phase whose closing condition is "check next week" is not a phase.
- **Size each step to what it is**, and don't restate in the plan what the design document or the
  linked issue already carries.

## Working through the plan

Once the plan is agreed, the issue body's plan is **append-only**. While implementing, tick its
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
3. A destructive step scheduled before the replacement has been observed working.
4. A phase with no stated exit condition, or one only a person can judge.
5. A step handed to a human that the agent could have performed itself.
