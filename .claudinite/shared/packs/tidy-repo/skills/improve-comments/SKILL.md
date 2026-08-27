---
name: improve-comments
description: Improve the comments in a repo's own source — delete the ones that restate the code or narrate a past edit, correct the ones that have drifted from what the code now does, and add the why where only a reader's guess carries it. Use when working a repo's comments as their own pass (the tidy-repo pack's improve-comments task), never as a side effect of another change.
---

# Improve a repo's comments

A comment decays as the code around it changes, and nothing makes it fail. A test that
has gone wrong goes red; a comment that has gone wrong is read, believed, and acted on.
This pass is the one that reads a slice of a repo **as comments rather than as code**.

**Deletion is the most common right answer.** A comment carries the *why*, or a cross-file
relationship the code cannot state itself. Everything else is a second copy of the code
that no build keeps honest — and the reader has to weigh it against the lines beneath it
before they can start on the actual question they came with.

## The one hard boundary

This pass changes **comments in code files, and `README.md` documents. Nothing else.** Not
a rename, not a moved line, not a reformat, not a "while I'm here" fix — those are their
own change, with their own review. It is checked, by stripping the comments from both sides
of every file the branch changed and comparing what is left, so a diff that also moved code
does not land whatever the run believes about it.

Two consequences worth knowing before you start:

- **A file whose language the parser cannot read counts as code**, so a comment edit there
  reds the run. The checkable set is `COMMENT_CHECKABLE` in
  [`engine/checks/helpers/code-scanning.mjs`](../../../../engine/checks/helpers/code-scanning.mjs);
  outside it, leave the file alone and say so in the wrap-up.
- **Adding or deleting a code file is never comment-only**, and neither is deleting a
  `README.md`. If a file's every comment should go, the file keeps its code and loses its
  comments — it does not lose itself.

## What to fix, in the order the value falls

Work the files you were given (a scheduled run gets them as binding scope; an owner's ask
names them in words) and never widen past them. In each, read every comment against the
code it sits above and ask which of these it is.

1. **It says what the code already says.** Delete it. This is the most common and the most
   valuable fix: a restating comment costs every future reader a re-read, and it is the
   first to go stale, because nothing depends on it being right.
2. **It no longer matches the code beneath it.** The change moved on and the comment did
   not. Correct it to what the code now does, or delete it if the why went with the old
   shape. A wrong comment is worse than no comment — this is the one that actively misleads.
3. **It narrates the edit that produced the code** — "removed the old path", "now uses X
   instead", "renamed from Y". Keep only the part still true of the code in front of the
   reader, and delete the rest. A comment describes a state, never a diff.
4. **It is a `TODO`/`FIXME` whose subject is already done, or whose issue is closed.**
   Delete it. One that is still live stays, and gets the issue number if it lacks one.
5. **A why is missing where a reader would have to guess it.** Add one — but only where you
   can state the reason from the code and its context, never a reason you inferred from the
   commit that happens to be in front of you. A guessed why is a wrong comment with
   confidence, which is shape 2 arriving pre-broken.

**Where a comment must name a path, spell it in one canonical place and point every other
mention there.** A path duplicated across comments is a rename waiting to break silently.

## What to leave alone

- **A comment you do not understand.** Not understanding it is not evidence it is wrong;
  it is evidence you are not the reader who can judge it. Leave it and move on.
- **A licence header, a generated-file banner, a pragma, a lint directive, a type
  annotation in a comment** (`@ts-expect-error`, `eslint-disable`, `# type:`). These are
  code wearing a comment's syntax, and deleting one changes behaviour.
- **A suppression's inline reason.** The corpus requires the reason at the suppression
  site; it is the review record, and it is load-bearing however redundant it reads.
- **A doc comment a tool publishes** (JSDoc, docstrings, Javadoc). It is an output surface,
  not an aside — improve it as documentation or not at all.
- **Anything outside the files you were handed.** A comment two directories away being
  wrong is next run's work.

## Finding nothing is a good outcome

A slice whose comments are already right yields no edit, and that is common in a repo that
has been swept before. Say so and change nothing: a pass that reworded five accurate
comments to look productive has spent every reader's attention and bought nothing.
