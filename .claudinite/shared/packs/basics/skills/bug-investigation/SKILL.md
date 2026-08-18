---
name: bug-investigation
description: Method for investigating a bug and pinning down its root cause. Use when investigating a bug report, when a fix didn't hold or a bug recurs, or when a report doesn't reproduce against main.
---

# Bug investigations

How to investigate a bug and pin down its root cause, independent of any one project. (For the broader, non-bug-specific engineering rules — naming, single source of truth, earning dependencies — see [the basics pack's RULES.md](../../RULES.md).)

- When a bug recurs after a "fix", suspect the diagnosis, not just the code — re-derive the cause from observation rather than iterating on the prior theory. Weight the repo's own shipped-working behavior over external or general claims (web search, blogs) when they conflict: prior working code is a real run; a stale external claim isn't.
- When a bug report doesn't reproduce against `main`, check the version gap before theorizing — compare the installed / `package.json` version to the latest release and use `git log -S` to verify whether the fix merged but hasn't shipped yet. The user runs the released build, not your checkout; the check costs seconds and rules out an entire class of theories before pursuing intermittency or environment.
- When you can't exercise the platform yourself, get one real datapoint from a minimal probe (have whoever can, run it) before committing to — or broadcasting — a root cause. Don't ship, or announce, a theory you could cheaply observe.
- When the system has a self-heal mechanism (retry, auto-repair, fallback path), never lean on it while working a bug — "the healer will catch it" is not a fix. Self-heal exists to keep production alive when something unforeseen slips through; a healer firing on a known defect is evidence the bug is live, not that it's handled. Root-cause and fix the primary path, and leave the fallback as the safety net it was designed to be.
- A bug theory predicts what you will find; it is not itself the finding. When you regenerate output, rerun a process, or otherwise get a chance to observe what a fix actually produced, read the run's own log or trace for what happened — don't explain the new artifacts by reasoning forward from your diagnosis of the original bug. A theory that fits the failure perfectly is exactly the one nobody double-checks, and a conclusion built on one true reason plus one merely-plausible one still needs the second reason corrected once you notice it was never verified.

