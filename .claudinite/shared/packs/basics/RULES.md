# Working discipline

The working discipline that isn't itself a GitHub operation — general habits for how to approach a
change, independent of any one project.

- **Starting any requested change** — begin from the *problem*, not the solution, in any
  repository and not just this one. Reach an explicit shared understanding with the owner of the
  problem the change is meant to solve **and** agreement that the requested change is the best way
  to solve it; a different fix, or none, may serve better.

- **Replying to an owner comment** — open with an explicit classification line,
  `Comment class: correction | feature | process-change | other`, where `other` covers questions,
  approvals and command phrases and a mixed comment names each part. An automation dispatch prompt
  is a comment too: class `other`, in your *first* substantive reply rather than at the end of the
  run. Put the class **alone on the line** and any explanation on the next one: the line is scanned
  for *every* class token on it, so restating the menu declares all of them. A class cannot be taken
  back, and a clean re-declaration further down does not override the first.

- **Acting on a correction** — you misunderstood something. Repair the shared understanding, then
  rework what the misread already touched; the artifact changes as much as the correction demands,
  but a correction never adds a new requirement or rule.

- **Acting on a feature** — agree on the requirement, record it in the project's requirements
  document (its executable spec, where it keeps one), write the test that proves it and watch it
  fail, then implement until it passes.

- **Acting on a process change** — the owner is changing *how* work is done. Land it as durable
  rules in the project's local scope, its own local packs (in Claudinite itself, its packs), routed
  through the mechanism promotion ladder (platform setting → hook → check → skill → prose).
  Promoting a rule into the shared canon is the growth lifecycle's separate call, not the
  interactive session's.

- **Choosing what goes on that ladder** — only a rule that constrains *how work is done* and
  outlives any one feature; a checkable signature doesn't earn a rule its place. Reject two shapes
  outright: a check that asserts particular code exists or still reads a particular way (it pins a
  point in time), and a rule derivable from the product's requirements (that is a requirement —
  take it to the feature path, the requirements document and the test that proves it).

- **Landing a rule anywhere on the ladder** — author the assurance first, the check the future
  world must satisfy, execute it and watch it fail, and only then make the fixes that turn it green.
  At the prose rung, where no check can carry an in-flight judgment rule, the equivalent step is
  showing the corpus doesn't already cover the rule before writing it.

- **Building a mechanism for a behavior** — verify against a real run that it isn't already
  provided.

- **Building release, deploy, versioning or CI plumbing** — look for the shared pack that owns it
  first; copying a mechanic from a sibling repo is the tell that it belongs centrally. If no pack
  owns it, report the gap rather than author a third copy.

- **Finishing a change** — watch it work **now**; never park it on "check tomorrow". What a task
  costs is its shelf-life, the time from starting it until everyone can forget about it.

- **Changing scheduled or unattended machinery** — force a run now (the scheduler's `FORCE_TASKS`
  lever, a `workflow_dispatch`, the fleet-wide force sweep) and watch it to a terminal state rather
  than wait for its next natural run.

- **Planning a migration** — prefer the design that converges in one forced pass to the one that
  trickles across nightly cycles, accept legacy input at the door so nothing has to wait for
  stragglers, and drive the stragglers with a standing mechanism rather than a phase someone must
  remember to close. Order the plan's phases by what blocks rather than by subject —
  [writing-migration-plans](skills/writing-migration-plans/SKILL.md) owns that sort.

- **When verifying now is genuinely impossible** (an external release window, an upstream fix in
  flight) — make the follow-up a mechanism that comes to you: a scheduled task, a watched PR, an
  issue something converges. Never a human's memory.

- **Receiving feedback that flags a misunderstanding** — check whether the artifact is already
  correct before expanding it; if it is, say so and push back rather than edit.

- **Writing anything** — size it to its idea: "open one issue" takes a sentence, not three
  paragraphs.

- **Correcting or auditing an artifact against an authoritative source** — derive the corrected
  version from the *source* before reading the existing draft, then diff against the old draft to
  surface what was actually wrong.

- **Acting on an approval to merge, ship or proceed** — it applies only *backward*, to the work
  already in front of the owner when it's given, never to anything requested or done *after* it. A
  later follow-up, even a fix to the just-approved change, needs its own explicit approval — and a
  multiple-choice answer is not an approval at all, even when an option's wording mentioned the
  action.

## Harness-tool contracts

Contracts worth knowing before you spend a call rediscovering them.

- **Searching for a tool with `ToolSearch`** — a search that finds nothing is evidence about your
  query, not about the environment. Search the fully-qualified name (`select:mcp__<server>__<tool>`,
  copied off the deferred-tools listing) and try the tool before telling the owner a step is theirs;
  the bare short name returns "no matching tools", which reads exactly like absence.

- **Calling `Edit`** — the file must have been read *with the read tool*; `cat`/`grep`/`sed` don't
  count. The moment shell output tells you which file you're about to change, read that exact path;
  a narrow offset window satisfies it.

- **Calling `Grep` with a context flag** (`-n`/`-A`/`-B`/`-C`) — it's silently ignored under the
  default `output_mode: "files_with_matches"`, so the call answers only a match count or file
  list, never the lines you asked for, with no error to catch it. Pass `output_mode: "content"`
  in the same call as any context flag.

- **Needing exact text from the web** — a summarizing fetch tool is not a source; when the bytes
  matter, `curl` into the scratchpad and read from disk. On a `403` don't retry and don't try a
  sibling URL — attribute the search snippet to the publisher instead of asserting it, and mark it
  for re-verification.

- **Hitting a sandbox or proxy that denies a fetch** — treat it as a **policy boundary, not an
  obstacle to route around**: don't reach for an open-network runner, an ad-hoc CI workflow or a
  push-triggered "probe", to make the request from somewhere the policy doesn't apply. Answer from
  committed reference material or ask the owner, and say plainly that anything unverifiable is
  unverified. Recognize a fetch tool's own signal for a domain-wide **egress block** (e.g. an
  explicit `EGRESS_BLOCKED` error) rather than reading it as an ordinary publisher `403` — a block
  is domain-wide, so working down a list of alternate sources for the same fact spends the same
  denial again on each one, where a `403` is at least per-site. And never file the gap as
  "re-verify next pass": no later agent pass can close a policy-level block either, so mark it as
  needing a human or an unblocked environment instead.

- **Scheduling a wake-up with the harness** — pass `prompt`, the instruction the woken turn is to
  act on, on any call that isn't `stop: true`; a no-op flag and a stated `reason` do not exempt it,
  and the call is rejected without it. A rejection leaves no fallback armed, which is what the
  `unattended-agents` skill's re-issue rule is for.

## Warnings and findings

- **Seeing a build, test or CI warning** — fix it rather than tolerate it, with a small, targeted
  fix that addresses the *cause* in the same change.

- **Suppressing a warning** — muting it with a flag (e.g. `--disable-warning`), `eslint-disable`,
  swallowing it — is **not** a small fix and never the quick path. Reach for it only as a
  deliberate, reviewed decision once the real fix has been weighed and rejected, and **carry the
  reason at the site**, on the suppression line or the comment immediately above it; that inline
  reason *is* the review record, so record no second justification elsewhere.

- **Waiving a finding on *text* rather than code** — try deleting the flagged phrase first; a
  waiver is for a crossing that genuinely must exist.

- **Working around a finding from a vendored check** — confirm the vendored copy is current first;
  the fix may already exist upstream and simply not be pulled in.

- **Deferring a warning you can't fix now with a small cause-addressing change** (it waits on an
  upstream release, or the real fix is a larger refactor) — open a dedicated issue unless one is
  already open, then move on. Search for that open one by the **invariant identifier** the finding
  names — the symbol, path or id it is *about* — never the sentence it arrived in: every filer
  paraphrases the message and prefixes its own stage's name, so the wording is the one part that
  differs across filings, and a new branch, PR number or run is not a new finding. Resolving it, by
  real fix or a consciously-chosen suppression, happens in that issue's own change.

# The task lifecycle

The issue → branch → PR lifecycle every new task follows, independent of any one project. The
rest of the git/GitHub procedures live in the `git-github-advanced` skill.

For every new task:

1. Create a GitHub issue describing the task before starting work.
2. Develop on a branch; reference that issue number in commit messages (e.g. `Refs #123`,
   `Fixes #123`, or `Closes #123`).
3. Update the issue's status (comments / close) as work progresses and when it's done.

- **Handing over a step only a human can perform** (flipping a repository or console setting,
  granting a permission, adding a secret) — first confirm you genuinely can't do it yourself, then
  give it **its own issue**, never a note in the PR body, with a checkbox per step, what breaks
  while each is off, and its closing condition. The exception is a step whose home is an artifact
  the human is already editing.

# Engineering practices

General software-engineering practices, independent of any one project; project-specific rules
(architecture, test mechanics) live in the consuming repo's own docs. Five neighbouring skills own
their own procedures: [git-github-advanced](../git-github/skills/git-github-advanced/SKILL.md) for
branch, commit and merge operations, [repo-text-sweeps](skills/repo-text-sweeps/SKILL.md) for
sweeps and renames across files, [writing-tests](skills/writing-tests/SKILL.md) for tests you can
trust, [bug-investigation](skills/bug-investigation/SKILL.md) for pinning down a root cause, and
[writing-migration-plans](skills/writing-migration-plans/SKILL.md) for a phased plan's ordering and
its tracking issue.

- **Naming a file, module, or symbol** — name it for its scope or responsibility, not the
  technology or mechanism behind it.

- **Referring to a value from more than one place** — prefer a shared constant or a reference over
  copying it, and generate derived data rather than hand-maintaining it. If you can't, add a drift
  guard: the generic `sharedConstants` check for a plain value, or one that runs the real logic
  against the copy in both directions when the duplicate mirrors matcher or predicate logic. Keep
  the guarded literal itself unbroken, since a value split across a line break is invisible to the
  guard and to a `grep`/`sed` rename alike. Have the guard's own text name the places it watches and
  why the split is forced, and don't also comment the duplication — the guard covers it.

- **Writing file A so it depends on file B** — say what A needs from B, or that it delegates, and
  don't re-spell how B does its job. If you're about to paraphrase B's procedure, point at B
  instead. This holds for code comments and Markdown alike. The test for whether a detail
  belongs: if that detail changes, does A actually care? A specific that wouldn't force A to
  change — B's cadence, B's file layout, the reasoning behind how B works — is B's detail, not
  A's, and doesn't belong in A even as color.

- **Committing** — one concern per commit: if two changes could each stand alone, split them, and
  a message that wants numbered items is the split talking. Once a commit has landed, revise with a
  new commit, never a rewrite of that one.

- **Working with a file a test or tool generates** — put `GENERATED` in its name, and don't
  hand-edit it; change the generator. Never resolve its merge conflict by hand: clear the markers
  with either side, re-run the generator against the merged inputs, and commit that output. Consider
  automating the clear with a `merge=ours` `.gitattributes` entry, and `git rerere` for a conflict
  that recurs.

- **Writing code that depends on how a platform or runtime behaves** — verify that behaviour
  against authoritative docs or a real run, not a comment or a prior commit's claim.

- **Optimising** — if the change is meant to preserve behaviour, prove it: hash the full outputs
  of both paths across every branch, fuzzing the inputs that select each, and accept only a
  bit-identical match. If the correctness risk outweighs the speed-up, leave the path alone and
  record that as a deliberate call.

- **Needing a library for a narrow job** — prefer a built-in, or a few lines. When the assumption
  that justified an existing dependency lapses, drop it.

- **Answering an edge case a review raised** — first check whether the existing composed rules
  already produce the right answer. If they do, add no production code: pin it with a regression
  test that asserts the contrast case too, plus an accept criterion where you track those, and don't
  re-state it in a comment.

- **Documenting a procedure** — read the authoritative external docs first and write only what
  they don't carry: our failure modes, gotchas, the exact path we ran. Don't document or recommend a
  path you haven't run, however standard it looks.

- **Writing code that can silently do nothing** — a swallowed error, a best-effort fallback, a
  probe-gated optimisation, a hint the runtime may ignore — record which path actually ran,
  reading the state back where the platform exposes it. During development, before the solution is
  proven right, add that debugging information first and remove it later. Without the record, a run
  where the capability never engaged is indistinguishable from one where it did and didn't help.

- **Persisting anything on a user's machine** — put it under the one user-deletable location, and
  extend that location rather than earn a second one. If the platform forces something outside it, a
  registration the OS owns, name that explicitly as the exception.

- **Changing what the software does with a user's data** — the permission string, privacy policy
  and store listing are part of the contract, so change them in the same commit. Retaining something
  new, opening a listener or adding an outbound connection changes the promise rather than adding a
  field: decide it explicitly and rewrite the disclosure before the code. Expect the claim in more
  than one place — grep the whole surface for the standing absolutes it touches ("no tracking",
  "no cookies", "no external assets") and reconcile every hit.

- **Driving an external runtime more than once in a session** — a headless browser, a device, a
  REPL, a deploy target — write one parameterised driver into the scratchpad, taking the target,
  the selector and the output path from argv, and re-point it rather than author a throwaway per
  invocation.

- **Automating something that needs live conversation context** — hook it to an existing human
  workflow event rather than background infrastructure; shell hooks have no conversation access and
  fire per turn, not at session end. Consider changing an existing command's definition — usually
  the cheapest trigger.

- **Writing the exit path of a pipeline or CI step** — an expected, handled outcome exits clean
  with a comment. Reserve non-zero for genuine breakage.

- **Piping a long command's output through `tail` (or `head`) to keep it readable** — it discards
  the pipeline's real exit code (`$?` becomes the trailing command's, not the one you're
  checking), so a mid-chain failure goes unnoticed, and any earlier summary lines the truncation
  cut are gone right when you need them. Redirect to a file (or `tee`) instead, read `$?` from
  that same invocation, and grep the file afterward for whatever slice you actually need — never
  re-run the whole thing to re-slice its output.

- **Killing a process by pattern** — `pkill -f` matches the invoking shell's own command line too,
  so never chain it, and bracket one character of the pattern (`[h]ttp.server 8099`) to break the
  self-match.

- **Working in a fresh checkout or sandbox** — a setup script may start in the repo's parent
  rather than the checkout, so `cd` in before running anything. A `Cannot find module` there is
  usually an install that hasn't run yet, not a code bug: install and re-run before hunting for a
  code-level cause.

- **Deciding where a config value or a classification lives** — avoid a default; require the value
  explicitly, or make it structural, derived from where the thing lives. Prefer a structural
  classifier to a hand-set field, and collapse a property tracked in several places into one. When
  automation maintains many copies of a config, have it materialize the explicit value into every
  file it maintains instead of interpreting absence.

- **Handling a value that can be unknown** — unknown is a state of its own: never encode it as a
  zero, an empty string or a type's default, and don't let a decoder collapse it into one. Keep it a
  missing key or an explicit null, keep the zero for a real zero, and preserve all three states at
  every stage of a pipeline. Treat absence as a permanent shape of the data rather than a gap to
  close, and where two fields claim the same fact, let each mean what its own source said and leave
  the call to the consumer.

- **Writing a check that scans the repo** — take the file set from `git ls-files` rather than a
  filesystem walk with paths to skip, and remember a brand-new file is untracked until you add it,
  so a green run isn't coverage of it. When scanning for a forbidden token, strip comments first so
  it matches code, not prose — string-aware, since a `//` inside a URL is not a comment. Reuse
  `stripComments` from
  [`engine/checks/helpers/code-scanning.mjs`](../../engine/checks/helpers/code-scanning.mjs); if the
  scan can't import it, inline the same pass and point a comment back at that source. Strip in
  **both** directions — a comment that documents or warns about the banned pattern is exactly
  where a naive check trips over its own reasoning, so a commented-out instance must not count as
  present either. And prove the check silent against the repo's own **real** sources, not only a
  synthetic clean fixture — a fixture spelling the same gap the check has just keeps proving the
  matching, and only a real-tree run can disagree with you.

- **Writing a comment** — carry the why, or a cross-file relationship the code can't state itself;
  if the code plus a known convention already says it, write nothing. Describe the current state,
  never the edit that produced it: don't explain the change you just made, and don't note what was
  removed or renamed. If a comment narrates a past fix, keep only the part still true of the code in
  front of you. When it must name a path, spell that path in one canonical place and point every
  other mention there.

