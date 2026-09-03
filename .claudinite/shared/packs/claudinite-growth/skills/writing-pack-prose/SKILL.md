---
name: writing-pack-prose
description: How pack prose is written — RULES.md rules, SKILL.md bodies and check text in a Claudinite pack, local or canon — brevity, structure, triggerability, findability, and the per-pack references doc. Loaded for any edit of a pack's RULES.md or SKILL.md, and when landing a lesson as prose.
metadata:
  force-load-on-file-edits-paths:
    - "**/packs/*/RULES.md"
    - "**/packs/*/skills/*/SKILL.md"
---

# Writing pack prose

Whether a candidate *qualifies* as a rule at all, and which mechanism carries it, is
[extracting-lessons.md](../../extracting-lessons.md)'s call — settle it there before writing.

**Start from the foundation:** read the "Write each rule" section of
[authoring-agent-docs](../../../basics/skills/authoring-agent-docs/SKILL.md) first — its
principles (concrete enough to verify, motivation stated, what to do rather than what not to,
the right altitude, emphasis reserved) bind pack prose too. This skill is the pack-specific
layer on top of them, and doesn't restate them.

## The ration

Every rule in a `RULES.md` is paid for by every session in every repo that declares the pack,
forever, whether or not it ever applies — so prose is rationed, and the ration is small.

- **One sentence per rule, near 40 words**: the trigger, the directive, and a consequence
  clause only where the rule cannot be applied without it. A candidate that needs a paragraph
  to land has not been understood well enough to be a rule yet.
- **An extraction pass adds at most two rules.** If more candidates clear the bar, write the
  two strongest and drop the rest — they will recur if they were real.
- **Split a rule that carries two situations.** Each situation is its own rule with its own
  trigger.
- A `SKILL.md` loads only when its activity is under way, so it may carry procedure at length —
  but it is still rationed by the same test: every line must change what the reader does.
  Method, steps and decision points belong there; anything a session must know *without*
  loading it belongs in `RULES.md` or a check, and rationale belongs in the references doc
  below.

## Shape a rule so it fires

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
  that goes stale. The exception is a mechanism you are telling the reader to *run*, below.
- **Telling the reader to *run* something** — ship the literal invocation in a fenced block, not
  the file's name. The reader is composing a call rather than looking a mechanism up, so a bare
  filename buys a probe every time — the `--help` that prints nothing, then the `cat`, then a
  hand-built command. (1)
- **Closing a block** — say what the other clauses make unnecessary ("don't also comment the
  duplication — the guard covers it"), so nobody adds belt-and-braces.
- **Keeping an exception** — an exception that changes what the reader would do is part of the
  rule; one that only reassures is padding.
- **Cutting a rule's prose** — drop rationale that only restates the rule, examples that
  re-express it, and mechanics another document owns. Keep the motivation itself: a consequence
  the reader needs in order to apply the rule under pressure earns its clause; rationale the
  reader doesn't need at act time goes to the references doc below.
- **Auditing a file of rules that already exists** — take each rule and ask what a reader would
  get wrong without it. Fold the one whose subject points back at its neighbour; cut the one another
  pack already carries, the one a check now enforces (keeping only the half the check can't see),
  and the one whose mechanism has since been retired — a rule naming code that no longer exists
  teaches a world the reader won't find.
- **Rewriting an existing rule** — carry the source's own strength forward. A rewrite must not
  weaken a rule, and it must not strengthen one either.

## The references doc — where a rule's rationale lives

A pack keeps **one** `references.md` beside its `RULES.md`, servicing all of the pack's prose
files and its checks. It exists for maintenance and review — the periodic pass that asks
whether a rule still earns its place needs the reason it was written — never for daily agentic
work: no rule sends its reader there, and no session loads it. So it stays in the repo that
owns the pack and never vendors: a member mounting a canon pack receives the rules, not the
reasoning behind them, and the pass that reaffirms them runs where the pack lives.

- **Adding a rule that has a rationale** — write the brief rule in `RULES.md` (or the skill),
  and put the reason in `references.md`. End the rule with the bare marker — `… never a
  filesystem walk. (3)` — and nothing else: don't name the references file, don't link it,
  don't ask the reader to follow anything. Not every rule needs one; a rule whose reason is
  self-evident from its consequence clause carries no marker.
- **Writing the entry** — one bullet per entry, keyed by the citing file's own namespace:
  `- **(RULES-3)** <reason>` for a rule in `RULES.md`, `- **(<skill-name>-3)** <reason>` for a
  line in that skill's `SKILL.md`; the marker in the prose file stays the bare `(3)` and
  resolves within its own file's namespace. Write the reason so a future review can **reaffirm
  the rule from it**: what would have to be true for the rule to be retired.
  - A **workaround** explains the issue with not using it, with the evidence (the failing run,
    the error, the measured cost).
  - A **technology guideline** cites the original documentation it derives from.
  - An **owner decision** carries the language of the request that set it.
- **Numbering** — numbers are stable identifiers, not positions: the next entry takes its
  file's next unused number, a removed entry leaves a gap, and nothing ever renumbers (a
  renumber breaks every marker at once). One entry may serve several rules in its file; a rule
  may cite several entries (`(3, 7)`).
- **A check's rationale** — the entry points at the check, since a declaration admits no
  comment and no new key: `- **(check:growth-write-scope)** <reason>`, same reaffirmation
  standard. There is no marker on the check side.
- **Removing a rule or check** — remove its entry in the same change, unless another rule
  still cites it.

The `references-integrity` check holds the mechanism together: every marker must resolve to an
entry in the pack's own `references.md`, and every `check:` entry must name a check the pack
still carries. The `rule-revalidation` task is the mechanism's consumer — it reaffirms
referenced rules and checks against their recorded reasons on its weekly pass.

## Migrating an existing pack onto the references doc

An existing pack — a repo's local pack, or a shared canon pack worked on canon-side (a member
never edits the mounted canon) — migrates opportunistically, one pack per pass, whenever a pass
is already editing it. An unmarked rule stays valid forever, so there is no fleet sweep to
force and no straggler to chase; the check only judges markers that exist.

1. **Create `references.md`** beside the pack's `RULES.md` on its first entry, not before.
2. **Work each rule**: keep the act-time consequence clause inline; move review-only rationale —
   the evidence story, inline issue ids, a cost the reader doesn't need mid-act — into an entry
   and end the rule with its marker. Shrink-only on the rules side: a rule may lose review-only
   rationale in this pass, never gain text.
3. **Recover the missing reasons from history, source-first**: for a rule that states no reason,
   read the commit that added it and that commit's PR and issue *before* re-reading the rule —
   derive the entry from the source, then diff against what the rule implied. The commit
   message, PR body and issue discussion are where this corpus already keeps a rule's evidence.
4. **Never invent an entry.** A rule whose reason can't be recovered stays unmarked — an audit
   or the `rule-revalidation` pass judges whether it still earns its place; a plausible-sounding
   fabricated rationale would let a future review reaffirm a rule on false grounds.
5. **Cover the checks** worth reaffirming with `check:` entries the same way, from their `why`
   text and their adding commit's PR.

## Evidence

The commit and its PR remain the archive — dates, session ids, quoted exchanges and the story
of the incident live there, never in the rule. What the references doc takes from them is only
the **reaffirmable core**: the reason and the minimum evidence a future review needs to re-test
it. Keep a measurement inline in the rule only where the number *is* the argument — a cost the
reader wouldn't believe stated qualitatively.
