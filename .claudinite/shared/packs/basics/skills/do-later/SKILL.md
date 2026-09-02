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

**Every field a run reads is one block on the first lines of the description**,
above the marker and ahead of your prose — the waits and the parameters together,
verbatim in this spelling:

```
Blocked-by: #<what this waits on>
Not-before: <ISO instant this may first run>
Model: <opus | sonnet | haiku>
Automerge: <policy>
Task: <pack>/<task>

<!-- filed by /do-later -->

<the brief>
```

Write only the lines the deferral actually has; each is explained below. A field
further down the body still parses, but nobody editing the issue can then see what
the run will do, and a retry that rewrites `Not-before:` has no one place to write
it. (1)

The two waits compose: an issue carrying both sleeps until every blocker has
closed **and** the moment has passed.

**What issue it waits on**, first match wins:

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

**What moment it waits on.** A deferral the owner words as a *time* — "check
tomorrow", "in a week", "not until after the release" — waits on an instant, and
`Blocked-by:` cannot express it. That is `Not-before:`, and it is the queue's own
wait field rather than a parameter: it is honoured whether or not the author holds
push access. Give it an ISO-8601 instant resolved against today's date
(`Not-before: 2026-08-28T09:00:00Z`) — the next scheduler run adopts the issue,
holds it blocked, and releases it on the first hourly pass after that instant.
A time-worded deferral is never case 4: it waits on the moment even when no issue
or PR is in flight, so it does not "queue immediately".

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
- **`Automerge: <policy>`** — the standing authorization to land the change
  without the owner's approval **when the run's diff turns out to sit inside the
  policy** (the run measures this with the policy engine, not you). The value is
  a policy expression: `anything`, a `;`-joined list of diff classes — built-ins
  like `comment-only-changes`, `doc-changes`, `test-changes`,
  `markdown-line-removals`, `markdown-trims`, `file-additions`, `generated-file-changes`, `javascript-changes`,
  `single-file-code-changes`, `single-folder-code-changes`, plus any class the
  repo's packs declare — each optionally `reject:`-prefixed, or `narrow-diff`
  (docs, tests, comment-only edits, and code within a single directory). A term
  can also name a folder inline, `under:<dir>` — any change of any kind inside
  that directory, and nothing outside it. Listing terms *widens* (a file need
  only match one); `&&` inside a term narrows, every part having to match:
  `under:docs && doc-changes`.

  **This field is never left unsettled, and never defaulted silently.** If the
  owner stated a policy, or said they want to see this one — "let me review it",
  "show me before merging", or any such wording, which outranks how small the
  change looks — you have your answer (the review case omits the field). When
  they said neither, **ask, before filing**: one `AskUserQuestion`, proposing as
  the recommended option the narrowest policy that plausibly covers the deferred
  change, with "leave it for my review" as the alternative. A declined or
  unanswered question files with no `Automerge:` field — review is the safe
  default only after the owner had the chance to choose.

  **Start that proposal from the folder.** You are deferring a *specific*
  change, so you almost always know the tree it lands in — and a folder bound
  holds where a kind bound does not: `doc-changes` authorizes Markdown anywhere
  in the repo, the root `README.md` and `CLAUDE.md` included, where
  `under:docs` authorizes one tree. So propose `under:<that dir>`, intersected
  with the kind wherever the kind is known too — `under:docs && doc-changes`
  for a documentation edit, `under:<that dir> && comment-only-changes` for a
  comment pass in one place. Leave the scope bare where the change legitimately
  carries more than one kind: `under:src/auth` covers the fix *and* the test
  beside it, where intersecting a code class would park the moment the test
  file joined the diff. Reach for a bare kind class only where no single tree
  bounds the change, as a repo-wide comment sweep is `comment-only-changes`. And a
  change spanning several unrelated trees has no scope at all: propose review,
  never a policy widened until it fits.
- **`Task: <pack>/<task>`** — only when the deferral is a run of a *named task*
  rather than "implement this issue". Left out, the run is the built-in request
  implementer, which is what a `/do-later` almost always wants.

These ride the same block as the waits, on the body's first lines.

If the mark does not exist in the repository yet, it cannot be applied (the API
refuses an unknown label, and only the scheduler run creates it). Say so in your
reply and leave the issue filed — the label appears on the next scheduler run, and
the owner can mark it from the issue page.

## Then say what you filed

One line back to the owner: the issue link, what it waits on, the model family,
and whether it will merge itself or come back for approval.
