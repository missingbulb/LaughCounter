# Working discipline

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
  through the mechanism promotion ladder (platform setting → schema → hook → check → skill
  → prose). Promoting a rule into the shared canon is the growth lifecycle's separate call, not
  the interactive session's.

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

- **Changing scheduled or unattended machinery** — force a run now (the scheduler's wake lever, a
  `workflow_dispatch`, the fleet-wide force sweep) and watch it to a terminal state rather than wait
  for its next natural run.

- **Planning a migration** — prefer the design that converges in one forced pass to the one that
  trickles across nightly cycles, accept legacy input at the door so nothing has to wait for
  stragglers, and drive the stragglers with a standing mechanism rather than a phase someone must
  remember to close. Write every phase's code — the cleanup, the destructive tail and every
  legacy tolerance's removal included — before asking for approval, and chain each execution step
  to the verification of the one before it rather than to anyone's memory;
  [writing-migration-plans](skills/writing-migration-plans/SKILL.md) owns that ordering and the
  chain's mechanics.

- **Filing the issues a multi-step plan or migration decomposes into** — take the owner's
  approval of the plan first, in one submission carrying a line per step, the graph of which
  step waits on which, and each link's automerge policy beside the diff it was predicted from.
  Filed first, the plan is a structure to react to rather than a decision to make. (5)

- **Adding a legacy tolerance** (a dual read, an accepted old spelling, a shim) — it is
  scaffolding, not a feature: ship it with an advisory that fires where the old shape is still in
  use, and with its removal already a link in the migration's chain, due one stated convergence
  window after that advisory reaches the holders. (2)

- **Choosing an automerge policy for a PR or a chain link** — write it as a prediction of the
  change's shape, the folders and kinds you expect the diff to touch, and never widen it to fit the
  diff that arrived: a policy that fails is the speed bump that puts a person back on the trail,
  not an error to route around. (1)

- **Predicting a change that could delete production data or degrade the experience past what a
  later PR undoes** — its policy is `nothing`, whatever its diff class; irreversibility is the
  first of the two things review here exists to catch. (1)

- **Handing over a change whose diff reached more folders or files than its request implied** —
  say so, and name the abstraction that would have kept it in one place: the reviewer reads which
  folders moved to judge whether the change made sense, and a wide diff for a small ask is the
  growth lesson review is for, not a defect. (1)

- **Retiring a system by folding its function into another** — audit that the live generator
  moved, not only its past output: a copied directory of old artifacts hides the generator's
  absence, and a stateless recompute over inputs kept for a bounded window starts the series
  shorter than the file it replaced.

- **When verifying now is genuinely impossible** (an external release window, an upstream fix in
  flight, an effect that only appears once the change is deployed, converged or loaded by a later
  session) — the follow-up is a mechanism that comes to you, never a human's memory and never an
  offer to the owner to go and check later. File it with
  [verify-in-production](skills/verify-in-production/SKILL.md), unasked, **once the PR has
  merged** and never before — a PR can be rejected, and a still-open branch can be rewritten
  under you, either of which strands a verification whose premise never reached `main`. The
  skill owns both halves — whether this change needs one at all (most don't; a test that ran is
  already the mechanism), and the issue that states what puts the change in production and what
  proves it works there.

- **Finishing a larger element** — one that earned a design doc or a phased tracking issue — a
  point verification is not enough: schedule the review that comes back once the element has
  lived in production about a week, asking whether it is working, misused, overused or underused
  against its real record — with the brief written at design time, expected amounts, signals and
  the metrics that measure them included, never improvised when the review runs.
  [production-retrospective](skills/production-retrospective/SKILL.md) owns the trigger, the
  brief, and the lane's other classes — canon, local-pack and fleet alike.

- **Receiving feedback that flags a misunderstanding** — check whether the artifact is already
  correct before expanding it; if it is, say so and push back rather than edit.

- **Writing anything** — size it to its idea: "open one issue" takes a sentence, not three
  paragraphs.

- **The primary source for a fact about a named, real person is blocked** (a profile behind a
  `403` or a paywall) — never substitute a data-broker or aggregator listing, and never publish
  the substitute under a caveat. Ask whoever is present instead: one question costs less than
  correcting a wrong public claim about someone.

- **Correcting or auditing an artifact against an authoritative source** — derive the corrected
  version from the *source* before reading the existing draft, then diff against the old draft to
  surface what was actually wrong.

- **Acting on an approval to merge, ship or proceed** — it applies only *backward*, to the work
  already in front of the owner when it's given, never to anything requested or done *after* it. A
  later follow-up, even a fix to the just-approved change, needs its own explicit approval — and a
  multiple-choice answer is not an approval at all, even when an option's wording mentioned the
  action.

## Harness-tool contracts


- **Calling `Edit`** — the file's content must be current in the session, which a read *or* a
  write in this session gives it. When neither has happened, read that exact path first; a narrow
  offset window satisfies it. Read it anyway whenever you need to see it — Edit's tracking shows
  you nothing. (3)


- **Polling with an `until` loop** — write a condition that names the state awaited (a file's
  arrival, a run's status): one already true on its first check is a blind sleep wearing a loop,
  as a bare `wait` in a later Bash call is — each call is a fresh shell, which is what
  `bare-wait-in-fresh-shell` refuses.

- **Handing the owner a command block to paste into their terminal** — carry no trailing
  `# comment` on any line: interactive zsh treats `#` as a comment only under
  `interactive_comments`, off by default, so the pasted line fails. Put the explanation in the
  prose around the block.


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
  already open, then move on. Resolving it, by real fix or a consciously-chosen suppression,
  happens in that issue's own change.

- **Searching for the issue a finding was already filed under** — search the **invariant
  identifier** the finding names, the symbol, path or id it is *about*, never the sentence it
  arrived in: every filer paraphrases the message and prefixes its own stage's name, so the
  wording is the one part that differs across filings, and a new branch, PR number or run is not
  a new finding.

# The task lifecycle

For every new task:

1. Create a GitHub issue describing the task before starting work.
2. Develop on a branch; reference that issue number in commit messages (e.g. `Refs #123`,
   `Fixes #123`, or `Closes #123`).
3. Open the PR with a closing keyword for that issue on its own line in the **body** —
   `Closes #123`. That is what fills GitHub's *Development* panel, the link between PR and issue
   that anyone browsing either one follows; `Refs #123` is a cross-reference and links nothing
   there. A PR that must not close its issue — one slice of a longer plan, one of several against
   a tracker — still links: give the slice its own issue and close that one.
4. Update the issue's status (comments / close) as work progresses and when it's done.

- **Spotting a change that should wait until the work in flight lands** — file it as work that
  comes back on its own rather than doing it now or trusting anyone to remember it: the
  [do-later](skills/do-later/SKILL.md) skill, which queues it behind what it waits on.

- **Filing anything into the ad-hoc queue** (a deferral, a verification, any marked issue) — it
  asks an unattended session **on this repository** to do the work, so only file what such a
  session can actually do here. A read of another repository or a console is not work it can do:
  that item parks minutes after it is picked, and a park is a person's problem filed under a
  mechanism's name. A public URL is the one exception, through the coded verification form
  (`verify-in-production`'s probes) and never by asking a session to fetch it.

- **Finding the queue cannot reach the work you were about to file** — do it now, hand it to a
  routine that has the reach, or do not file it — and say which of the three you chose.


- **Handing over a step only a human can perform** (flipping a repository or console setting,
  granting a permission, adding a secret) — first confirm you genuinely can't do it yourself, then
  give it **its own issue**, never a note in the PR body, with a checkbox per step, what breaks
  while each is off, and its closing condition. The exception is a step whose home is an artifact
  the human is already editing. How that issue is *written* — the checklist as the whole artifact,
  every explanation below it — is
  [writing-handover-issues](skills/writing-handover-issues/SKILL.md).

# Engineering practices

- **Naming a file, module, or symbol** — name it for its scope or responsibility, not the
  technology or mechanism behind it.

- **Referring to a value from more than one place** — prefer a shared constant or a reference over
  copying it, and generate derived data rather than hand-maintaining it. If you can't, add a drift
  guard: the generic `sharedConstants` check for a plain value, or one that runs the real logic
  against the copy in both directions when the duplicate mirrors matcher or predicate logic.

- **Writing that drift guard** — keep the guarded literal unbroken, since a value split across a
  line break is invisible to the guard and to a `grep`/`sed` rename alike. Have the guard's own
  text name the places it watches and why the split is forced, and don't also comment the
  duplication — the guard covers it.

- **Guarding two copies written in different languages** — pair them by name, applying the known
  casing transform to derive one identifier from the other, rather than by literal value: one
  value can be a numeric substring of another. (4)

- **Writing file A so it depends on file B** — say what A needs from B, or that it delegates, and
  don't re-spell how B does its job. If you're about to paraphrase B's procedure, point at B
  instead. This holds for code comments and Markdown alike. The test for whether a detail
  belongs: if that detail changes, does A actually care? A specific that wouldn't force A to
  change — B's cadence, B's file layout, the reasoning behind how B works — is B's detail, not
  A's, and doesn't belong in A even as color.

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

- **Changing an observable behavior your own docs make a claim about** — not only privacy: when
  a site deploys, a job's cadence, which targets are supported. Grep the doc surface for what the
  change falsifies and correct it in the same commit, or the doc goes on describing behavior the
  code no longer has.

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

- **Writing a comment** — carry the why, or a cross-file relationship the code can't state itself;
  if the code plus a known convention already says it, write nothing. Describe the current state,
  never the edit that produced it: don't explain the change you just made, and don't note what was
  removed or renamed. If a comment narrates a past fix, keep only the part still true of the code in
  front of you. When it must name a path, spell that path in one canonical place and point every
  other mention there.
