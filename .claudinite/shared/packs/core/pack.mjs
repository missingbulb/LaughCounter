import rulesIndexCurrent from './rules-index-current.mjs';
import coreDeclared from './core-declared.mjs';
import conformanceWorkflow from './conformance-workflow.mjs';
import taskDeclarationShape from './task-declaration-shape.mjs';
import taskDeclarationMatchesFolder from './task-declaration-matches-folder.mjs';

// Claudinite's own surface in a repo that runs it: the vendored mount, the
// declaration that activates a pack, adopting Claudinite and adopting a pack,
// and the contract every scheduled task is written to.
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
// so `core-declared` reports a member that has lost the entry rather than being
// what puts it there.
export default {
  id: 'core',
  version: 1,
  minEngineVersion: 1,
  ruleRoutingGuidance: {
    belongs: 'using Claudinite itself — the vendored mount, the pack declaration, bootstrapping, adopting packs, the self-refresh update, the scheduled-task contract',
    excludes: 'general working discipline and the task lifecycle — basics; capturing lessons into packs — grow_with_claudinite; git procedure — git-github',
  },
  badge: 'badge.svg',
  detect: null,
  marker: null,
  seededByDefault: true,
  prose: 'RULES.md',
  // The consumer-isolation wall (claudinite-isolation) is a declared check — a
  // forbidReferences entry in this pack's declared-checks.json, run by the
  // engine's reference-scanning like any barrier. The barriers pack stays
  // required for the per-repo config rule members' own edges ride.
  requires: ['barriers'],
  worldRules: [
    // The declaration itself, and the index the declaration produces — the two
    // things that decide whether this member is running Claudinite at all.
    coreDeclared,
    rulesIndexCurrent,
    // The member's plumbing — the CI gate its maintenance PR merges through
    // (relevance-first: inert until the repo carries the artifact). The
    // scheduler workflow's shape rule (scheduler-workflow-shape) is a declared
    // check in this pack's declared-checks.json.
    conformanceWorkflow,
    // The scheduled-task contract (scheduled-tasks.md), likewise inert until the
    // repo carries a tasks/<name>/task.mjs of its own; its third rule
    // (task-phase-discipline) is a declared check in declared-checks.json.
    taskDeclarationShape,
    taskDeclarationMatchesFolder,
  ],
  workRules: [],
  // Bootstrapping a repo, and adding a pack to one already bootstrapped. Both
  // were bundled in grow_with_claudinite, whose subject is lesson capture.
  skills: [
    'adopt-claudinite',
    'adopt-pack',
  ],
  // Both scheduled tasks live in this pack's `tasks/`, discovered by the
  // scheduler's filesystem scan (engine/scheduler/discover.mjs) rather than
  // declared here: `update`, the per-repo self-refresh every member runs, and
  // `adopt-requested-packs`, which acts on a repo's pack-adoption requests.
  //
  // `update` being HERE is what `core-declared` is blocking for. A member runs it
  // from its vendored copy and discovery finds only a literally-declared pack's
  // tasks, so a repo that loses this pack's entry loses its self-refresh — and
  // nothing is left that could deliver it one.
};
