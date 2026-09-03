# growth-extract

## Why the declaration reads as it does

Carried over from the declaration's comments when it became `task.json`.

claudinite-growth task: growth-extract — the growth lifecycle's CAPTURE
stage (per-project-scheduling DESIGN §6). ONE task over BOTH lesson sources:
it runs the extract-from-activity skill over the window's commits/PRs/issues
and the extract-from-conversations skill over the captured conversation logs,
then runs prose-to-checks over what it just wrote to see whether any of it
upgrades to a check — and lands the whole run through a single PR delivered
per the repo's delivery settings (task.md → the shared deliver-pr.md
procedure). Worker: task.md.

The two halves were separate tasks (growth-extract + conversation-extract)
firing at the same daily anchor, each opening its own PR against the same local
packs on the same night. They shared the lesson bar, the promotion ladder, the
dedup surface and the landing mechanics, so splitting them bought nothing and
cost a second opus dispatch, a second PR, and two runs deduping against a
corpus the other one was concurrently writing. One task, two source skills.

The ordering, declared (tasks-dispatch DESIGN §9) — and now the ONLY thing carrying it, since
the staggered anchor hours retired with the twice-daily cron (§17.1). This task reads a mount
`claudinite-lifecycle/update` converges, so it yields while that task's item is live this
cycle and runs the moment it converges — or rolls. The offset only ever implied this; the
declaration enforces it.
A substantive default-branch change is the whole trigger — the term names the
commits, and task.md says what else the window puts in scope.
Lessons land in the repo's own local packs — prose, and the checks the in-run
upgrade pass produces (this pack's merge-rules.json declares both classes).
