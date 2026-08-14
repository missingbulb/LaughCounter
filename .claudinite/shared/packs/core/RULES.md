# core — working with Claudinite itself

Claudinite's own surface in a repo that runs it: the vendored mount, the declaration, adoption, the
self-refresh, and the contract a scheduled task is written to.

- **Reading a rule, check or skill that arrived from Claudinite** — it is vendored, under
  `.claudinite/shared/`, and the update flows replace that whole tree. Never edit anything there:
  change it in the canon, or carry the difference in this repo's own `.claudinite/local/packs/`.

- **Wanting a pack's rules to apply here** — declare its id in `.claudinite-checks.json`. Nothing
  activates by being mounted, fingerprinted or present on disk, so a pack whose files you can see
  but whose id is undeclared contributes no prose, no checks, no skills and no tasks.

- **Adding a pack** — run the `adopt-pack` skill, which declares it, asks its adoption questions,
  re-vendors and scaffolds. Never hand-copy a pack's content into the repo.

- **Setting a project up on Claudinite for the first time** — the `adopt-claudinite` skill.

- **Deciding which pack owns a lesson** — read `packs/directory.GENERATED.md`, the catalog of
  *every* canon pack, never the mounted subset: the mount holds only what this repo declares, so the
  pack that owns the territory may be absent and invisible. When the owning pack is merely too
  narrow, widen its `ruleRoutingGuidance.belongs` rather than opening a local pack beside it.

- **Judging whether Claudinite is current here** — read the stamp's `ref`, `engineVersion` and
  `packVersions`, never `claudinite.updated` on its own: a held stamp pins `updated` behind a
  pending note while the mount keeps converging normally, so it looks stalest when it is fine.

- **Writing or changing a scheduled task** — [scheduled-tasks.md](scheduled-tasks.md) is the
  contract, and the precondition is the only place a task may decide not to run.

- **Answering "why did the mount not update"** — read the member's own artifacts (its declaration,
  its stamp, the head sha's runs) before theorizing about a platform setting; propose a settings
  change as a conclusion, never as a diagnosis.
