# Rule revalidation — re-probe the claims whose truth lives outside this repo

Most of a pack's prose is judgment: how to approach a change, what to do first, what never to do. Judgment does not expire. A smaller set of rules is different — each one asserts a **fact about the environment**: that the harness accepts a call in a certain shape, that the Action's token can or cannot reach a path, that an MCP tool exists, that a platform behaves a particular way. Those were true on the day they were written and are true today only by luck, because nothing in this repo turns red when a platform moves under them. The prose stays green, sessions keep obeying it, and the cost arrives as a session spent on a route that closed.

This task re-runs the probe behind each such claim, weekly, and corrects what no longer holds.

The run's **Context section is binding scope**: it names the **pack paths** to revalidate and the two probe rules below. Work those paths — a consuming repo's own local packs by default; Claudinite also its core `packs/`. A canon pack a repo only mounts is revalidated in the repo that owns it, on this same task.

Open a PR and leave it for review. This task rewrites the rules sessions obey, on evidence a reviewer cannot re-derive from the diff, so every run's changes go in front of the owner.

## What counts as a revalidatable claim

A sentence in a rule, a check's `failureMessage` or `fix` text, or a skill's procedure, that would be **falsified by a change nobody in this repo makes**. The three richest seams:

- **The Claude environment** — tool contracts and their failure modes (what `Edit` requires before it will apply, what a scheduling call rejects, what a search returns for a bare name), which harness surfaces exist, what a session can and cannot see.
- **GitHub permissions and API behaviour** — what the Action's `GITHUB_TOKEN` may push or label, what a path refuses, which status a call returns, what a repository setting gates.
- **MCP functions** — that a named tool exists, what its parameters are called, what it returns, which server carries it.

Also fair game: any rule naming a version floor, a runtime's behaviour, or an external service's response shape.

**Not** in scope, and left alone without a probe: judgment and taste rules; rules about how *this* repo is organized (a check already guards those, and a stale one fails loudly); product requirements; anything whose truth a reviewer could settle by reading the tree.

## The referenced rules — reaffirm against the recorded reason

A pack's `references.md` (the writing-pack-prose convention: a rule ending `(n)` cites entry *n*; a `- **(check:<id>)**` entry covers a check) widens what this task can judge, because the entry records **what would retire the rule** — the one thing a probe of the environment alone cannot know. For each marked rule and each covered check in the scoped packs:

- A **workaround** entry re-probes the recorded issue where the probe rules below allow: if the problem it routed around no longer reproduces, the rule (or check) is a retirement candidate — proposed in the PR for the owner, never deleted on this run's own verdict, since the entry's evidence may exceed what one probe can re-create.
- A **technology guideline** entry is re-checked against the documentation it cites: a moved or contradicting source is corrected like any stale claim; an unreachable one is `unprobed`.
- An **owner decision** entry is not probeable — verify only that the decision hasn't been superseded in this repo's own record, and otherwise report it `doc-verified`.

A rule with no marker is judged exactly as before — the mechanism is opt-in per rule, and an unmarked rule is never flagged for lacking one. Correct a stale *entry* in the same PR as its rule, and keep the entry's number (numbers are stable identifiers; `references-integrity` holds the marker↔entry resolution, not this task).

## The probe

A claim is revalidated by **executing the smallest thing that would distinguish true from false**, and reporting what actually happened — never by recalling what you know, and never by reasoning from the rule's own wording.

Two rules bound it, and they bind every run whatever it is working on:

1. **Read-only.** Probe by doing the harmless half: call the tool and read its schema, request the resource, run the command that reports rather than acts. A claim whose probe would **write, delete, merge, publish, notify, or spend a credential** is not probed — verify it against authoritative documentation and say in the log that documentation, not a run, is the evidence.
2. **A probe you cannot run is `unprobed`, not disproven.** This session carries the reach its repo was provisioned with, which is not the reach every rule was written under. A tool that is absent *here*, a permission denied *to this session*, a network path the sandbox blocks — none of that is evidence the claim is stale. Leave the rule exactly as it stands, log it as unprobed, and move on. Rewriting a rule into "you cannot do X" because *this* session could not is the single worst outcome available to this task: it is unfalsifiable afterwards, and it removes a capability from every future session.

## What a run does

1. **Enumerate.** **Which pack paths to revalidate** is this repo's own setting: `claudinite-growth`'s `pack_paths` in `.claudinite-settings.json`, defaulting to `.claudinite/local/packs` when it is unset, empty, or not a list — the same setting [prose-to-checks-sweep](../prose-to-checks-sweep/task.md) reads, so a repo names its capture surface once. List **every** revalidatable claim in those paths, by the test above. Most of a pack is judgment prose and out of scope, so this set is far smaller than the corpus — and taking all of it every run is what lets this task hold no state between runs: there is nothing to remember about what a previous run covered. Order the work by what staleness would cost — a rule that would send a session down a dead path before a version number in a comment — so a run that runs out of budget has spent it on the claims that mattered, and says in its PR body which claims it did not reach.
2. **Probe each**, per the rules above, and record what you ran and what came back.
3. **Correct what is stale**, as far as the probe reaches and no further — one probe answers one claim, and a neighbouring claim it seems to imply gets its own probe. Rewrite the rule to what the probe showed, in the same voice and at the same length, and carry the *new* fact — not a note about the correction, and not a dated changelog. Where the claim was a check's premise rather than prose, and the check itself is now asserting a dead fact, fix the check and its fixture. Where a claim has become simply irrelevant (the surface it describes is gone), delete the rule whole rather than trimming it toward nothing.
4. **Open a PR** — one per run, on a per-run-unique branch, its commit referencing the tracking issue so the `task-lifecycle` gate passes. The PR body is the evidence a reviewer cannot re-derive: per changed rule, the probe run and its result. Keep the repo's offline test suite green.
5. **Report every verdict in the PR body**, and record the corrections in the pack. The PR body carries the full list — every claim probed with its verdict, `holds`, `stale (corrected)`, `unprobed (why)` or `doc-verified`, and the probe behind each — because a reviewer cannot re-derive any of it from the diff, and an `unprobed` claim needs naming as loudly as a corrected one. A correction in a **shared canon** pack also bumps that pack's version and lands its `VERSIONS.md` row, which is what tells a member what the bump shipped; a local pack keeps no such file, so its commit is the whole record. There is no standing issue.

A run that found everything still true opens no PR at all, and says so in its run log.
