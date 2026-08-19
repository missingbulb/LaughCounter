import commentClassification from './comment-classification.mjs';
import referenceIntegrity from './reference-integrity.mjs';
import markdownLinkLabels from './markdown-link-labels.mjs';
import filePlacement from './file-placement.mjs';
import sharedConstants from './shared-constants.mjs';
import declaredCheckMessages from './declared-check-messages.mjs';

// The baseline pack: cross-project working discipline, the task lifecycle, and
// the general engineering skills. Declared explicitly like every other pack — no pack is active by
// default. Bootstrap's --init seeds the declaration and the nightly update
// backfills it into existing consumers; never fingerprinted (the declaration is
// authoritative — dropping it is a deliberate choice).
export default {
  id: 'basics',
  // 2 — the mechanism rename (migrations/2026-08-13-mechanism-versioned). The FIRST
  // bump this pack has taken, and the invariant it establishes: a record's declared
  // `version` must be ≤ this number, and this number must MOVE for that record to
  // reach a member already at the previous one. `migrationApplies` is `want > have`
  // against the stamped version, and what gets stamped is this manifest's number — so
  // a record declaring a version above it would re-apply every cycle, forever,
  // draining never.
  version: 7,
  minEngineVersion: 1,
  ruleRoutingGuidance: {
    belongs: 'cross-project working discipline, issue-branch-PR lifecycle, repo hygiene, doc/reference integrity and the baseline engineering, testing and debugging skills',
    excludes: 'technology-specific content — its own tech pack; GitHub Actions workflow or platform behaviour — github-actions; git procedure — git-github',
  },
  badge: 'badge.svg',
  detect: null,
  marker: null,
  seededByDefault: true,
  prose: 'RULES.md',
  // `core` is required rather than assumed: this pack is declared everywhere, so
  // the closure is what puts Claudinite's own rules in front of every session, and
  // `barriers` arrives with it. git-github carries the git/GitHub side of the task
  // lifecycle (#385).
  requires: ['claudinite-lifecycle', 'git-github'],
  // Rules that audit the repo as it stands, whatever this session did.
  // warning-suppression and rules-line-length are declared checks in this
  // pack's declared-checks.json, discovered structurally beside these.
  worldRules: [
    markdownLinkLabels,
    declaredCheckMessages,
    filePlacement,
    sharedConstants,
  ],
  // Rules that judge the change and the session in front of you — the branch's
  // commits, the diff, the conversation. task-lifecycle and squash-merge-history
  // are declared checks carrying scope: "work", discovered structurally beside
  // these.
  workRules: [
    commentClassification,
    referenceIntegrity,
  ],
  // The baseline skills — general engineering practice every project's work
  // can call for, whatever its technology — bundled under skills/ in this pack's
  // own tree and mounted wherever basics is declared (which --init seeds
  // everywhere). When one stops being a baseline activity, move its directory to
  // the pack whose projects need it and move this line with it (#385 moved the
  // git/GitHub and Claudinite-lifecycle skills out).
  //
  // `task-janitor` and `ci-performance` are this pack's scheduled tasks,
  // discovered by the scheduler's filesystem scan (engine/scheduler/discover.mjs)
  // rather than declared here.
  skills: [
    'authoring-agent-docs',
    'bug-investigation',
    'bump-version',
    'ci-performance-evaluation',
    'file-placement',
    'repo-text-sweeps',
    'writing-migration-plans',
    'writing-tests',
  ],
};
