---
name: extract-from-conversations
description: Mine an agent-user conversation — a captured conversation log or the live session — for friction-driven lessons (misunderstandings, backtracks, measured wall-time waits) and land them in the repo's own local packs. Use when extracting lessons from a session transcript or the conversation-logs branch, or when an owner asks for a retrospective.
---

# Extract lessons from a conversation

Read one agent ↔ user session — its turns *and* the actions taken in it — and convert its friction into
changes that make the **next** run faster, clearer and less dependent on human steering. Read how the
work went; what the work committed is [extract-from-activity](../extract-from-activity/SKILL.md)'s.

The **bar** a lesson must clear, the **local promotion ladder** it descends, and where a repo's capture
surface lives stay canonical in [extracting-lessons.md](../../extracting-lessons.md) — read it, don't
re-derive it. What follows is only what reading a *conversation* adds.

## The goal

Every pass optimizes for one outcome: **the next run needs less.** Less clarification, less rework, less
waiting, less human steering. Read the session not as "what did we accomplish" but as "where did this
cost more than it should have, and what durable change removes that cost next time." If a pass can't name
a concrete next-time saving, it found nothing — and that's fine.

## Where the conversation comes from

- **A captured log** on the repo's orphan `conversation-logs` branch (`<stamp>--issue-<n>--<session>.jsonl`),
  read with plain git in the checkout — `git show origin/conversation-logs:<file>`. The log carries
  per-entry timestamps, per-message token usage, and the `tool_use`/`tool_result` pairs behind every
  wall-time number, which is exactly what the measured analysis below needs. This is the routine path.
- **The live session**, when an owner asks in plain words for a retrospective. Same method; deliver the
  capture as a branch + PR **for a human to review**, never one that self-merges.

**Never reflect-and-edit unprompted in the middle of a task** — it interrupts the work; the owner decides
when a session is done enough to mine.

## What to look for — the friction signals

Read the conversation end to end and hunt for these signatures. Each marks a place the loop cost more than
necessary, and each converts to a specific durable fix.

### 1. Misunderstandings between agent and user

The signs: a clarifying-question round-trip; the user correcting an assumption ("no, I meant…"); the agent
building the wrong thing and reworking it; the user restating the same request; an `AskUserQuestion` whose
answer was, in hindsight, the obvious default.

**Convert to:** encode the resolved understanding so the next agent never has to ask. Every question the
user answered is a candidate **default**; every correction is a candidate **convention or glossary entry**;
a recurring wrong assumption is a candidate **confirm-first checkpoint placed earlier**, or a clearer doc
the agent reads cold and gets right the first time. The test of a good fix: next time the agent proceeds
correctly **without the round-trip**.

### 2. Suboptimal agent actions

The signs: the agent took an approach then backtracked; did redundant or repeated work; re-ran a command
that had already failed for a knowable reason; reached for a heavy tool where a light one fit; reinvented
something the codebase already provided; re-read a file it had just written to "verify"; missed an existing
convention and had it corrected in review.

**Convert to:** a rule pointing at the right approach or tool, a pointer to the existing helper/convention
so it's found first, or a **footgun note placed where it'll be read** (the usage-site-vs-central call is in
[extracting-lessons.md](../../extracting-lessons.md)). The test: next time the agent takes the good path
first, not after a detour.

### 3. Long wall-time waits — and measure them

The signs: independent operations run **serially** that had no dependency and could have been parallel; a
padded fixed `sleep` that over- or under-shot; a process **waited out after its result was already in
hand**; blind long polling; re-running a check (e.g. CI) that was already green.

**Measure, don't hand-wave.** Quantify the wait with real wall-clock numbers from the log's own timestamps
and separate the kinds of time — compute (a compile, a test/render run) vs. genuine **idle waiting**
(sleeps, polling, a finished process not yet killed). The numbers are computable, never estimated. A fix is
only credible against numbers; name the **single highest-leverage change** that shortens it, or conclude it
was already optimal.

**Convert to:** a batch/parallelize rule, a poll-with-rolling-backoff instead of a blind sleep,
kill-the-process-once-its-output-is-in-hand, or merge-on-an-already-green-check. (These are the subject of
the standing **efficiency analysis** in [the unattended-agents skill](../unattended-agents/SKILL.md) — fold
a wall-time finding into that frame rather than re-deriving it.) The test: same result, less wall clock, no
loss of quality.

## Encode the questions the user keeps asking

The single highest-leverage move for **less human feedback**: the questions a user asks *repeatedly* are a
checklist the agent should run **itself.** If the user keeps asking "how many processes ran — could it be
fewer?", "what took longest?", "did you kill it the moment its work was done?", stop waiting to be asked —
fold those exact questions into a **standing self-check the agent answers proactively** at the end of the
relevant work, and close with a terse verdict (a concrete change, or an explicit "already optimal"). Each
recurring question converted this way is one the user never has to ask again — and it's where a *measured*
retrospective comes from: the user's recurring efficiency questions, answered pre-emptively, with numbers.

## Two windows per run: the newest day, and the oldest day still on the branch

Every run reads exactly two sets of captures, both taken from the filename stamps:

- **the last 24 hours** — the fresh pass, over what was captured since the previous run;
- **the first 24 hours on the branch** — every capture stamped within 24h of the oldest one still there.
  This is the hindsight pass, and it is a real re-read rather than a formality: a friction signal that
  looked situational when it was fresh may have recurred since, and a lesson landed since may have made a
  keeper redundant. Both directions are legitimate outcomes, and corpus dedup makes the overlap harmless.

The two windows are also what keeps deletion honest. Retention is an agentless task that prunes on the
stamp alone, with no handshake back to this one — safe because the branch is read from its oldest end
every run, so a capture reaches retention having been read. Reading less than the oldest window silently
breaks that; reading more is only wasted effort.

## Provenance: summarize the exchange, never paste it

For each rule that actually **lands** from a log, post one short comment on the issue the log names
(`--issue-<n>--` in its filename; **`--issue-0--` means the capture had no associated issue**, so there is
nothing to post on and the rule simply lands without a comment):

- one provenance line — the rule added, the capture date, the session id;
- then a **200-word-max** description of just the slice of conversation that caused the rule: what was
  asked, what went wrong or got corrected, and why the rule follows from it.

**Summarize, never transcribe.** The dialogue itself is far too verbose for an issue — no pasted turns
beyond a short quoted phrase, never raw JSONL, never a rendered transcript. A log that yields nothing gets
**no** comment: extraction is the only path to permanence, and a log's conversation is gone once retention
deletes it. That is a deliberate call, so a padded "lesson" written to feel productive costs more than the
silence it replaced.
