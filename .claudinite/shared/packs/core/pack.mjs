import claudiniteIsolation from './claudinite-isolation.mjs';
import rulesIndexCurrent from './rules-index-current.mjs';
import coreDeclared from './core-declared.mjs';
import conformanceWorkflow from './conformance-workflow.mjs';
import schedulerWorkflowShape from './scheduler-workflow-shape.mjs';
import taskDeclarationShape from './task-declaration-shape.mjs';
import taskDeclarationMatchesFolder from './task-declaration-matches-folder.mjs';
import taskPhaseDiscipline from './task-phase-discipline.mjs';

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
  // The consumer-isolation wall rides the barriers mechanism: this pack
  // CONTRIBUTES the fixed barrier as manifest data (claudinite-isolation.mjs —
  // pure data, no cross-pack import; pack-independence).
  requires: ['barriers'],
  contributes: { barriers: [claudiniteIsolation] },
  worldRules: [
    // The declaration itself, and the index the declaration produces — the two
    // things that decide whether this member is running Claudinite at all.
    coreDeclared,
    rulesIndexCurrent,
    // The member's plumbing — the CI gate its maintenance PR merges through, and
    // the scheduler workflow that fires its tasks. Both relevance-first: inert
    // until the repo carries the artifact.
    conformanceWorkflow,
    schedulerWorkflowShape,
    // The scheduled-task contract (scheduled-tasks.md), likewise inert until the
    // repo carries a tasks/<name>/task.mjs of its own.
    taskDeclarationShape,
    taskDeclarationMatchesFolder,
    taskPhaseDiscipline,
  ],
  workRules: [],
  // Bootstrapping a repo, and adding a pack to one already bootstrapped. Both
  // were bundled in grow_with_claudinite, whose subject is lesson capture.
  skills: [
    'adopt-claudinite',
    'adopt-pack',
  ],
  // The scheduled task that acts on a repo's pack-adoption requests lives in this
  // pack's `tasks/`, discovered by the scheduler's filesystem scan
  // (engine/scheduler/discover.mjs), not declared here.
};
