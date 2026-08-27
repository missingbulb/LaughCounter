---
name: extract-from-activity
description: Mine a window of a repo's commits, merged PRs and issue activity for durable, reusable lessons and land them in the repo's own local packs. Use when extracting lessons from repo artifacts — the growth-extract task's activity half, or an owner asking what a recent stretch of work taught.
---

# Extract lessons from repo activity

The **artifact** half of lesson extraction: mine what a window of work left behind — commits, the PRs
merged in it, the issue discussion around them — for durable, reusable lessons, and fold each into the
repo's **own local packs**. Its sibling [extract-from-conversations](../extract-from-conversations/SKILL.md)
mines the *dialogue*; this one never sees a conversation, only what the work committed.

The **bar** a lesson must clear, the **local promotion ladder** it descends, and where a repo's capture
surface lives are shared with that sibling and stay canonical in
[extracting-lessons.md](../../extracting-lessons.md) — read it, don't re-derive it. What follows is only
what reading *artifacts* adds.

## Capture at the repo's own level

Write each lesson at whatever level reads naturally for this repo — refer to its files, services, or
mechanics wherever that's what makes the lesson clear. Don't force either extreme: don't contort a lesson
to be hyper-specific, and don't polish it into a general, portable rule. Making a lesson portable is the
growth lifecycle's **promote** stage, done canon-side later over whatever merged here; here, just capture
it usefully and let promotion lift whatever turns out to travel.

## Read the window — and read merged PRs properly

Work only the window you were handed (a scheduled run gets it as binding scope in the work item's
Context; an owner's ask names it in words). Never widen it.

1. **The commits** — full bodies, and the diff wherever a fix is non-obvious.
2. **The PRs merged in the window** — read these *first* and read them *whole*: the diff **and** the
   review discussion. A merged PR is usually the window's richest lesson source, because it records what
   was tried, what a reviewer pushed back on, and why the landed shape won. A verdict reached in review
   is a lesson already argued; the commit alone shows only the winner.
3. **The issue activity** it names — the comments changed on those numbers.

## What artifacts signal — and what they don't

The signals worth converting here are the ones an artifact can carry: a fix whose diff is small but whose
*reason* is not obvious from the code; a review comment that names a convention the author missed; a
revert or a follow-up fix that says the first shape was wrong; a PR that grew several rounds because its
approach was re-decided mid-flight.

**An already-settled, already-enforced implementation choice is not a lesson.** If a check or a test
already pins the shape — which roots a CI sweep walks, which contract a construction must satisfy — and
all that is left to say is *why it looks like that*, it belongs at the implementation site rather than as
prose in a pack — and this run does not write there, so the candidate is dropped. A rule earns its place by
steering a **future** decision or catching a **repeatable** mistake, not by narrating a past one that is
already locked in.

Wall-time and dialogue friction (a clarifying round-trip, a backtrack, a wait sat through) leave no trace
in a diff. Don't infer them from artifacts — that is the conversation sibling's territory, working from
logs that actually carry the timestamps.

## Landing it

Route each keeper down the ladder in [extracting-lessons.md](../../extracting-lessons.md) — a declared
check first, a custom code rule only where patterns can't say it, then pack skill, prose last — into the
local pack whose territory owns it. Write more checks and less prose, and keep each addition terse and in
the repo's own voice.

A new check ships with its **red-first fixture**: see it fail on a violating fixture and pass on a clean
one. Declare `since: '<today>'` on it — a `blocking` check is enforced as advisory for its first two weeks,
so a check whose backlog the tree still carries can land now and bite later. A rule that cannot be made
confident lands as prose instead — never as a broken check.

Finding nothing is a perfectly good and common outcome; a duplicate or invented "lesson" is worse than
adding nothing.
