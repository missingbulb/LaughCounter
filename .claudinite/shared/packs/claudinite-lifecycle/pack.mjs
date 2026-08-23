
// Claudinite's own surface in a repo that runs it: the vendored mount, the
// declaration that activates a pack, adopting Claudinite and adopting a pack.
//
// EVERY RULE HERE JUDGES A MEMBER'S CLAUDINITE STATUS — is this repo declared,
// converged, gated and scheduled such that Claudinite works in it. Rules about
// how the canon's own content is maintained are not this pack's, however much
// they look like it.
//
// MANDATORY. `basics` requires this pack, which both vendors its content and
// materializes its declaration wherever a declaration is written; the
// migrations/2026-08-14-core-seed record declares it into members that already
// exist. Both run outside any check — activation reads the literal declaration,
// so `claudinite-lifecycle-declared` reports a member that has lost the entry rather
// than being what puts it there.
export default {
  version: '60823.1',
  minEngineVersion: '60822.1',
  ruleRoutingGuidance: {
    belongs: 'using Claudinite itself — the vendored mount, the pack declaration, bootstrapping, adopting packs, the self-refresh update',
    excludes: 'working discipline and the task lifecycle — basics; authoring Claudinite content, scheduled tasks included — claudinite-growth; git — git-github',
  },
  seededByDefault: true,
  // The consumer-isolation wall (claudinite-isolation) is a declared check — a
  // forbidReferences entry in this pack's declared-checks.json, run by the
  // engine's reference-scanning like any barrier. The barriers pack stays
  // required for the per-repo config rule members' own edges ride.
  requires: ['barriers'],
  // Both scheduled tasks live in this pack's `tasks/`, discovered by the
  // scheduler's filesystem scan (engine/scheduler/discover.mjs) rather than
  // declared here: `update`, the per-repo self-refresh every member runs, and
  // `adopt-requested-packs`, which acts on a repo's pack-adoption requests.
  //
  // `update` being HERE is what `claudinite-lifecycle-declared` is blocking for. A member runs it
  // from its vendored copy and discovery finds only a literally-declared pack's
  // tasks, so a repo that loses this pack's entry loses its self-refresh — and
  // nothing is left that could deliver it one.
};
