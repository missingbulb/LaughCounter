---
name: do-later
description: File a change to be made AFTER the work in flight — a well-defined issue, marked for the queue and blocked behind the current PR/issue and behind the previous deferral, so repeated asks chain. Use when the owner says "/do-later …", "do this after this lands", or otherwise defers a change instead of derailing the session.
---

# /do-later — defer a change into a chained request run

The owner has spotted a change that should happen **after** the work in front of
them. Doing it now derails the session; an ordinary issue waits for somebody to
remember it. This files it as an **ad-hoc request** (tasks-dispatch DESIGN §16):
an issue the queue picks up on its own, held behind what is still in flight.

You are filing work, not doing it. Touch no source file, open no branch.

## What you write

**One issue, well defined.** The run that implements it will never see this
conversation — the issue body is the whole brief. State the change, the files or
surfaces it touches if you know them, what "done" looks like, and anything the
owner ruled out. Size it to its idea; a rename is a sentence.

Give the body these two lines, verbatim in this spelling — the scheduler run reads the
first one:

```
Blocked-by: #<what this waits on>

<!-- filed by /do-later -->
```

**What it waits on**, first match wins:

1. the issue of the **previous `/do-later` you filed in this session** — that is
   the chain the owner asked for, each deferral behind the last;
2. otherwise the **pull request** the session's work is on, if one is open;
3. otherwise the **issue** the session is working on;
4. otherwise nothing — omit the field, and say in your reply that it queues
   immediately.

Only ever name blockers that will actually *close* — a merged PR does, a branch
does not. If you filed an earlier `/do-later` this session but no longer have its
number, find it by its marker line among the repo's open issues rather than
falling back to (2).

## The mark, and the parameters in the body

**The mark is one label**: **`task:origin:ad-hoc`** (`mcp__github__issue_write`,
`labels`). The next scheduler run adopts the issue — writing its machine block
into the body and giving it a status — and the issue itself becomes the work
item, so the whole run plays out where the owner is already looking. Nothing else
is a label any more; everything below rides the issue **body**, and is honoured
only for an author with push access on the repository.

- **`Model: <family>`** — the family **this** session is running, so the deferred
  work is done by what the owner is working with now. Read it with `get_session`
  (claude-code-remote, `session_id` omitted) and map `session_context.model` to
  `opus`, `sonnet` or `haiku`. A model outside those three is left out, and the
  run takes the task's default.
- **`Automerge: if-narrow`** — the standing authorization to land the change
  without the owner's approval **when the run's diff turns out to be narrow**
  (docs, tests, comment-only edits, and code within a single directory; the run
  measures this, not you). **Withhold it whenever the owner said they want to see
  this one** — "let me review it", "show me before merging", or any such wording
  outranks how small the change looks.
- **`Task: <pack>/<task>`** — only when the deferral is a run of a *named task*
  rather than "implement this issue". Left out, the run is the built-in request
  implementer, which is what a `/do-later` almost always wants.

Keep the fields on their own lines, above the marker line, beside `Blocked-by:`.

If the mark does not exist in the repository yet, it cannot be applied (the API
refuses an unknown label, and only the scheduler run creates it). Say so in your
reply and leave the issue filed — the label appears on the next scheduler run, and
the owner can mark it from the issue page.

## Then say what you filed

One line back to the owner: the issue link, what it waits on, the model family,
and whether it will merge itself or come back for approval.
