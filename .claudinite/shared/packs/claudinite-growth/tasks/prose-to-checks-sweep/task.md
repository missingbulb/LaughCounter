# Prose-to-checks — sweep this repo's pack prose

Mine the **existing** prose of this repo's packs — each pack's `RULES.md` / `SKILL.md` — for
always-testable rules that were never converted to checks, and convert the strongest ones. Work the
*backlog* only: prose this run's siblings already wrote is [growth-extract](../growth-extract/task.md)'s
own upgrade pass, not this sweep's.

**Which pack paths to sweep** is this repo's own setting: `claudinite-growth`'s `pack_paths` in `.claudinite-settings.json`, defaulting to `.claudinite/local/packs` when it is unset, empty, or not a list. Read it at the start of the run and work only those paths — a consuming repo sweeps its own local packs; Claudinite also sets its core `packs/`. **Never** edit a read-only mounted canon pack under `.claudinite/shared/`: the next converge replaces that tree whole.

Convert prose to checks in a single PR.

## The method lives in the skill

The conversion method — how to spot an always-testable rule in prose, judge convertibility, author the check plus its **see-it-fail** fixture, and decide what stays prose — is owned by the [**prose-to-checks** skill](../../skills/prose-to-checks/SKILL.md). Follow it; don't re-derive it here. This worker only frames the unattended run around it.

## What a run does

1. **Pick convertible prose** under the Context's pack paths — rules that govern **how we work** (not what the product does — see the skill's first gate), that are *always testable* (a deterministic condition a check could assert), and that no existing check already covers. Prefer the strongest, clearest candidates; converting one or two solid rules well beats churning many shakily.
2. **Convert per the skill** — author the rule module in its owning pack, register it in that pack's `pack.mjs`, and add a **fixture test that fires on a violating input and stays quiet on a clean one** (see-it-fail is mandatory — a check that can't be made confident is left as prose, never shipped broken). Then apply the skill's **deletion test** to the prose the check now stands beside — a paragraph the check fully covers is deleted whole, never trimmed.
3. **Deliver into the standing PR** — the conversions land under the title `Claudinite growth: prose to checks`. Search the repo's OPEN pull requests for one titled exactly that. **If one exists, push this round onto its branch and extend its body** — this round joins the review already pending rather than starting a second one, so a reviewer who has not got to last week's work reads one PR, not three. **If none exists, open one** with exactly that title on a per-run-unique branch. A merged or closed round is not open, so the next run starts a fresh PR by itself. Either way the commit references the tracking issue so the `task-lifecycle` gate passes, and the repo's offline test suite is green before you push.

   The title is how the next round finds this PR. A round titled anything else starts a second review instead of joining this one.
4. **Say what converted in the PR body** — the prose converted and the check id it became, per conversion. That, and the commit, are the record; there is no standing issue. A conversion in a **shared canon** pack also bumps that pack's version and lands its `VERSIONS.md` row, which is what tells a member what the bump shipped; a local pack keeps no such file.

## What this task must never do

- **Never ship a check that can't be made confident** — the see-it-fail fixture is the gate; an unprovable rule stays prose.
- **Never convert a rule an existing check already covers** — dedupe against the check set first.
- **Never convert a statement of what the product does** — a rule asserting which entities exist, what a surface renders, or that a feature's parts are wired together is a **requirement**, and belongs in the project's executable spec and the suite that proves it. Such a rule is testable, so it passes the check-the-world test on its own; the skill's first gate is what stops it. Found in pack prose it is already mis-homed — leave it and log it, never cement it as a check.
- **Never touch a pack path outside the Context**, and **never edit a mounted canon pack** under `.claudinite/shared/` — a consumer improves only its own local packs.
- **Judging convertibility and authoring checks + fixtures is heavy judgment** — a check that reds on correct work costs every session in the repo, so convert only what you can prove.
