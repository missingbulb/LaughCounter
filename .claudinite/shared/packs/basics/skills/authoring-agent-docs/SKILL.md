---
name: authoring-agent-docs
description: How to write instruction files coding agents follow reliably. Use before writing or editing any Claude instruction doc — a project CLAUDE.md, a convention doc, a routine spec.
---

# Writing instruction files coding agents follow

How to author the files an AI coding agent reads — a project CLAUDE.md, a convention doc, an
agent or automation spec — so it follows them reliably. Grounded entirely in Anthropic's
published guidance; bracketed numbers cite the sources listed at the end.

## Know what an instruction file is (and isn't)

- Treat the file as context, not enforced configuration: the agent reads it and tries to
  follow it, with no guarantee of strict compliance. Anything that must happen every time
  (block a write, run a linter before commit) belongs in a deterministic hook instead. [1][2]
- Everything loaded at session start competes for a finite attention budget, and recall
  degrades as context grows ("context rot"). Aim for the smallest set of high-signal tokens
  that produces the behavior you want. [4]
- Keep the always-loaded file to facts that apply broadly in every session. Move multi-step
  procedures and sometimes-relevant domain knowledge into on-demand skills, and rules that
  matter for only part of the codebase into path-scoped rule files. [1][2]

## Decide each line's right to exist

- Include what the agent can't infer from code: build and test commands, style rules that
  differ from language defaults, repo etiquette (branch naming, PR conventions),
  project-specific architecture decisions, required env vars, non-obvious gotchas. [2]
- Exclude what it can figure out by reading code: standard conventions, file-by-file codebase
  descriptions, detailed API docs (link instead), frequently changing facts, and self-evident
  practices like "write clean code". [2]
- For each line, ask: "Would removing this cause the agent to make mistakes?" If not, cut it.
  Bloated instruction files cause the agent to ignore the instructions that matter. [2]
- Target under 200 lines per CLAUDE.md; longer files consume more context and reduce
  adherence. Splitting into imports organizes but does not save context — imports still load
  at launch. [1]

## Write each rule

- Be concrete enough to verify: "Use 2-space indentation", not "Format code properly";
  "Run `npm test` before committing", not "Test your changes". [1]
- Apply the golden rule: show the instruction to a colleague with minimal context — if they'd
  be confused, the agent will be too. [3]
- State the motivation behind a rule, not just the rule; the model generalizes from the
  explanation. [3]
- Tell the agent what to do instead of what not to do: "write flowing prose paragraphs"
  steers better than "do not use markdown". [3]
- Use numbered steps when the order or completeness of steps matters. [3]
- Prefer a few (3–5) diverse, canonical examples over a laundry list of edge-case rules, and
  wrap them in `<example>` tags so they can't be mistaken for instructions. [3][4]
- Pitch rules at the right altitude: specific enough to guide behavior, flexible enough to
  leave the model strong heuristics — avoiding both brittle hardcoded if-then logic and vague
  guidance that assumes shared context. [4]
- Reserve emphasis ("IMPORTANT", "YOU MUST") for tuning adherence on rules that slip. [2]

## Shape a rule so it fires

House practice rather than published guidance — the rest of this file cites its sources, and
this section has none. It is how the rules in this corpus's `RULES.md` files are phrased.

- **Keying a rule to its trigger** — open with the act the reader is performing, not the state
  of the world the rule applies to. Nobody notices that "a value is unknown"; they notice they
  are writing an encoder. A rule keyed to a state never fires, because nothing brings the
  reader to it.
- **Keying a rule the reader reaches while debugging** — name the symptom that sends them
  looking ("A fetch to a host you listed failing in-browser"), not the act that caused it. By
  the time the rule is wanted the act is over, and the symptom is what they can see.
- **Keying a rule that corrects a misconception** — name what the reader wants ("Wanting
  `import`/`export` in extension code"), not the wrong move they might make ("Reaching for a
  bundler"). Someone who doesn't yet know the move is wrong won't recognise themselves in it.
- **Phrasing that trigger** — use the words the reader would use for the situation, and put
  them first and in bold, so the rule is findable by scanning the left margin alone.
- **Choosing the unit** — one block per situation, not one bullet per rule. A reader arrives
  holding a problem, so give them the whole decision in one place rather than a cross-reference
  to three neighbouring bullets.
- **Splitting a rule that only makes sense after the one above it** — don't. If the subject
  needs a "that" pointing back ("Writing that record"), it is a clause of the rule above, not a
  situation of its own. Split when a reader could arrive at the second rule without the first.
- **Separating the blocks** — one blank line between rules. The block is what a reader lands on,
  and an unbroken run of bullets makes them scan lines instead; the separation costs one token.
- **Ordering a file of many rules** — past roughly fifteen, group them under headings naming the
  surface each concerns, so a reader scans headings before subjects. A flat list that long makes
  every bold subject do the work one heading would.
- **Grouping that separates two rules which qualify each other** — add an explicit pointer from
  the general rule to its exception, or the general one reads as unconditional. That pointer is
  the one sentence a rewrite may add that its source didn't have; name it as an addition when
  you report the change.
- **Ordering the clauses** — the default first, then the `if you can't` fallback, then
  `consider` for an optional aid, then the `don't` that the earlier clauses make unnecessary.
- **Choosing modality** — grade it per clause and claim no more than the rule needs. Keep
  `never` and `always` for the genuinely absolute and reach for `prefer`, `avoid` or `rather
  than` otherwise; escalating a `don't` into a `never` changes the rule rather than rewording
  it.
- **Naming a mechanism** — name the check, helper or skill that owns the mechanics, and stop.
  Its parameters, options and failure modes live with it, and restating them here is a copy
  that goes stale.
- **Closing a block** — say what the other clauses make unnecessary ("don't also comment the
  duplication — the guard covers it"), so nobody adds belt-and-braces.
- **Keeping an exception** — an exception that changes what the reader would do is part of the
  rule; one that only reassures is padding.
- **Cutting a rule's prose** — drop rationale that only restates the rule, examples that
  re-express it, and mechanics another document owns. Keep the motivation itself: a consequence
  the reader needs in order to apply the rule under pressure earns its clause.
- **Carrying the evidence a rule came from** — dates, issue and session ids, quoted exchanges and
  the story of the incident are archaeology, and the commit that added the rule keeps them. Keep a
  measurement only where the number *is* the argument — a cost the reader wouldn't believe stated
  qualitatively ("the retry ran to 81% of a session's tool wall-clock"). A rule that reads as a
  post-mortem with a directive at the top is the wrong way round.
- **Auditing a file of rules that already exists** — take each rule and ask what a reader would
  get wrong without it. Fold the one whose subject points back at its neighbour; cut the one another
  pack already carries, the one a check now enforces (keeping only the half the check can't see),
  and the one whose mechanism has since been retired — a rule naming code that no longer exists
  teaches a world the reader won't find.
- **Rewriting an existing rule** — carry the source's own strength forward. A rewrite must not
  weaken a rule, and it must not strengthen one either.

## Structure the file

- Group related rules under markdown headers and bullets; the agent scans structure the way
  readers do, and organized sections are easier to follow than dense paragraphs. [1]
- Separate content types — background, instructions, tool guidance, output format — into
  distinct sections with consistent, descriptive names (Markdown headers or XML tags). [3][4]
- Make a task spec self-contained: name the files and interfaces involved, state what is out
  of scope, and end with an end-to-end verification step that proves the work. [2]
- Give the agent a check it can run — a test suite, build exit code, linter, or comparison
  script. Without one, "looks done" is its only stopping signal. [2]

## Maintain it like code

- Start minimal and add rules in response to observed failures: the agent makes the same
  mistake a second time, a review catches something it should have known, or you retype last
  session's correction. [1][4]
- Test edits by observing whether behavior actually shifts. If a rule keeps being ignored,
  the file is probably too long and the rule is lost in the noise. [2]
- Remove contradictions: if two rules conflict — including across nested or imported files —
  the agent may pick one arbitrarily. [1]
- Prune regularly. If the agent already behaves correctly without a rule, delete it or
  convert it to a hook. Check the file into version control so the team contributes and it
  compounds in value. [2]
- When a practice is withdrawn, rewrite the docs that taught it into the **current** rule in the
  present tense — never leave a passage narrating what used to be done and why it stopped. A reader
  who never knew the practice doesn't need to be taught it in order to be told the rule, and
  describing a withdrawn technique is how it keeps getting rediscovered; the history belongs to the
  commit that removed it. This bans narrating a *superseded* way of working, not evidence — measured
  costs that argue a live rule is worth its space stay. And retiring a practice is not the moment to
  install a guard against it: a check earns its place from a mistake that repeats, not from the
  deletion that prompted it.

## Sources

- [1] https://code.claude.com/docs/en/memory
- [2] https://code.claude.com/docs/en/best-practices
- [3] https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/be-clear-and-direct
- [4] https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents

