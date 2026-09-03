# logs-prune

## Why the declaration reads as it does

Carried over from the declaration's comments when it became `task.json`.

claudinite-growth task: logs-prune — retention on the `conversation-logs`
branch. `agent_model: 'none'` with `code_work: 'node worker.mjs'`: the whole pass
is deterministic code the scheduler runs as a subprocess — no agent, no dispatch
issue, seconds of runtime. The same shape usage-fold already has over the same
branch.

WHY IT IS NOT PART OF growth-extract. Deleting a capture past retention is
arithmetic on dates over an orphan branch — which is why the extract worker had
to spend prose forbidding an agent to merge that branch or rewrite its history.
Coupled to the opus run it also kept that run's precondition carrying a second
arm whose only job was to fire the prune on a quiet repo, so a repo with nothing
to extract still paid an opus dispatch on the nights one log aged out.

WHAT MAKES AGE ENOUGH. The prune used to be coupled to a judgment step — an aged
log got a final pass before deletion — so pruning on the calendar risked deleting
a capture nothing had read. What removes the risk is the extract run's READING
WINDOW, not a per-file handshake between the two tasks: growth-extract reads from
the oldest end of the branch on every run, against a retention measured in days,
so a capture reaches retention having been read. The extract-from-conversations
skill owns that window; this task owns the arithmetic.

The whole contract is this default export; the retention arithmetic it names is
in preconditions.mjs beside it.
A CLOCK crossing a boundary, not repo movement (the term beside this file):
the prune must keep firing on exactly the repos that went quiet.
It opens no PR: its whole write is remove commits on the non-default logs
branch, which is outside the outcome taxonomy (per-project-scheduling DESIGN §1).
One ls-remote, one fetch, one tree read, at most one push — against a branch
whose size retention itself bounds. Seconds. The bound is protection against a
hung network call, not headroom for work, so it sits just past the slowest
plausible fetch rather than at the leash.
