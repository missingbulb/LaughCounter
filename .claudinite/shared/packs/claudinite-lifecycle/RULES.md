# core — working with Claudinite itself

- **Reading a rule, check or skill that arrived from Claudinite** — it is vendored, under
  `.claudinite/shared/`, and the update flows replace that whole tree. Never edit anything there:
  change it in the canon, or carry the difference in this repo's own `.claudinite/local/packs/`.

- **Finding a mounted skill, or following a link from inside one you already loaded** — a canon
  skill lives at `.claudinite/shared/packs/<pack>/skills/<name>/SKILL.md`; there is no flat
  `.claudinite/shared/skills/`. When the `Skill` tool announces a per-session flat "base directory"
  (e.g. `.claude/skills/<name>/`) that holds only that one `SKILL.md`, any relative link the
  skill's own text carries (to a sibling doc, a sibling skill) was written for its real home and
  dangles from that announced base — resolve such links against the canon path instead.

- **Wanting a pack's rules to apply here** — declare its id in `.claudinite-settings.json`. Nothing
  activates by being mounted, fingerprinted or present on disk, so a pack whose files you can see
  but whose id is undeclared contributes no prose, no checks, no skills and no tasks.

- **Adding a pack** — run the `adopt-pack` skill, which declares it, asks its adoption questions,
  re-vendors and scaffolds. Never hand-copy a pack's content into the repo.

- **Setting a project up on Claudinite for the first time** — the `adopt-claudinite` skill.

- **Deciding which pack owns a lesson** — read `packs/directory.GENERATED.md`, the catalog of
  *every* canon pack, never the mounted subset: the mount holds only what this repo declares, so the
  pack that owns the territory may be absent and invisible. When the owning pack is merely too
  narrow, widen its `ruleRoutingGuidance.belongs` rather than opening a local pack beside it.

- **Judging whether Claudinite is current here** — read the stamp's `engineVersion` and
  `packVersions`, never `claudinite.updated` or `ref`: the versioned flows stamp versions and
  nothing else, so those two hold the provenance of the last full re-vendor rather than of this
  mount, and a member converging nightly reads as weeks stale.

- **Answering "why did the mount not update"** — read the member's own artifacts (its declaration,
  its stamp, the head sha's runs) before theorizing about a platform setting; propose a settings
  change as a conclusion, never as a diagnosis.

- **A file a vendored module references but that is absent from `.claudinite/shared/`** — that is
  evidence about the vendor set, not the canon: check the canon itself (a shallow clone, or a
  canon-scoped session) before filing an issue claiming it was never shipped, and where you can't,
  report only that the mount lacks the file.

- **An engine source comment under the mount points at a design doc** (`DESIGN.md`) — the mount
  vendors `.mjs` sources and pack docs only, never the canon's internal design-doc tree, so the
  pointer dangles in every member. Read the module's own header comment, which restates what the
  missing section would have said. (1)

- **Running `check_the_world.mjs` or `check_the_work.mjs` and seeing no output** — that is the
  clean result, not a stall: a run with no findings prints nothing and exits `0`. Append
  `; echo "EXIT:$?"` if in doubt, rather than a second pass of `--help`/`head`/`tail` hunting for
  confirmation that silence is safe. (2)

- **Pushing a change that touches `.github/workflows/`, `.claudinite-checks.json` or pack config**
  — the world sweep runs in CI, not the Stop hook, so run it locally first rather than spend a
  push → CI → fix round trip on a finding it reports in seconds:

  ```
  node .claudinite/shared/engine/checks/check_the_world.mjs
  ```
