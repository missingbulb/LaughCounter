# Tidy — improve comments

The tidy sweep's fourth dimension, and the only one whose subject is the repo's own source.
Read the files this run was handed **as comments rather than as code**, fix what is wrong
there, and leave everything else exactly as it was.

The run's **Context section is binding scope**: it names the files whose comments this round
reads. That is the work; do not widen it, and do not read a file it does not name.

## The run

**Run the [improve-comments](../../skills/improve-comments/SKILL.md) skill over the files in
Context, and nothing else.** That skill owns the whole method — which comment shapes are worth
fixing, in which order, what earns a comment its place, and what to leave alone. Don't re-derive
any of it here, and don't extend it: this worker exists to frame the run and deliver its PR.

If an edit touches something a test reads (a doc constant, a comment a check greps for), run the
repo's offline test suite and keep it green before opening the PR.

## The hard boundary, and what enforces it

This run changes **comments in code files, and `README.md` documents. Nothing else.** Not a
rename, not a moved line, not a reformat, not a fix you noticed on the way past — each of those
is its own change, with its own review.

`improve-comments-scope` (beside the skill) is what makes that a guarantee rather than a
request: it strips the comments from both sides of every file this branch changed and reds the
run if what is left differs. It keys on this run's pinned commit subject, so **commit with the
subject `Claudinite tidy: improve comments`** — without it the gate does not recognise the run
and the safety case does not hold.

Two consequences the skill states and this run lives with: a file whose language the parser
cannot read counts as code, so leave its comments alone; and adding or deleting a code file, or
deleting a `README.md`, is never within this pass.

## Output: one PR, left for review

If the run changed at least one comment, it lands all of it through a **single PR** — one commit
for the whole round on a per-run-unique branch, titled `Claudinite tidy: improve comments`, its
commit referencing the tracking issue so the `task-lifecycle` gate passes.

**Open it and stop.** Never arm auto-merge, never merge it. The scope check proves the diff is
comment-only, which is what makes this pass safe to run unattended — it says nothing about
whether the comments it wrote are *right*, and a confidently wrong comment is the exact failure
this task exists to remove. A human reads the words.

Say in the PR body what the round did **not** cover: the files Context named that you left
untouched because their comments were already right, and any the precondition dropped from scope
this round. A comment sweep that looks like a full sweep and was not is how a repo comes to
believe its comments have been read.

## A round that changes nothing

Common, and a good outcome — a slice whose comments are already right, or one whose only
candidates were in files the parser cannot read. Open no PR, and say which it was.

## What this task must never do

- **Never change anything but comment text and `README.md` content** — see the boundary above.
  A code fix you spot is an issue to file, never an edit to slip in.
- **Never widen past the Context window** — the files named there are the scope, whatever a
  neighbouring file's comments look like.
- **Never rewrite a comment you don't understand.** Not understanding it is evidence about the
  reader, not the comment.
- **Never invent a why.** A reason you cannot state from the code and its context is a guess,
  and a guessed why is a wrong comment written with confidence.
- **Never reword an accurate comment to have something to show.** Changing nothing is the
  expected result of a repo that has been swept before.
