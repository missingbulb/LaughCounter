// Declare the `core` pack into every existing member.
//
// WHY A RECORD IS THE ONLY CARRIER. Content travels on its own: `basics` requires
// `core`, and every writer of a vendor set resolves that closure, so core's files
// land in a member's mount with nothing else needed. The DECLARATION does not —
// `resolveDeclaredPacks` only materializes a dependency when the declaration is
// being written, which happens at `--init` and nowhere else in a running member.
// Nothing in the update flows rewrites a member's `packs` list, deliberately: that
// file also holds its interview answers and every reviewed `accept`. So the pack
// would be mounted and inert — `isActive` reads the literal list — and its checks,
// skills and tasks would simply not run, silently, fleet-wide.
//
// SEED, NEVER OVERRIDE (the `declarePacks` op's contract): a member that already
// declares `core` keeps its entry untouched, config and all. Idempotent thereafter.
//
// NO `appliesTo`. The op's own gate is the right one — it reads
// `.claudinite-checks.json` and returns early when there is none, which is exactly
// "not a Claudinite member". Every member needs this pack; there is no subset.
//
// THE DURABLE DRIVER IS THE CHECK, NOT THIS RECORD. `core` is a NEW pack, so no
// member carries an installed version for it and `migrationApplies` falls back to
// the recency window — a repo dormant past it never sees this record at all. That
// is why `basics` ships `core-declared`: a member the record missed reports itself
// instead of running quietly without Claudinite's own rules.
export default {
  id: 'core-seed',
  landed: '2026-08-14',
  version: 1,
  summary: 'the core pack — Claudinite\'s own mount, declaration, adoption, update and task-contract rules — is declared in every member',
  declarePacks: [{ id: 'core' }],
};
