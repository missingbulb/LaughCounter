
// The baseline pack: cross-project working discipline, the task lifecycle, and
// the general engineering skills. Declared explicitly like every other pack — no pack is active by
// default. Bootstrap's --init seeds the declaration and the nightly update
// backfills it into existing consumers; never fingerprinted (the declaration is
// authoritative — dropping it is a deliberate choice).
//
// Its skills/ holds general engineering practice every project's work can call for,
// whatever its technology, mounted wherever basics is declared (which --init seeds
// everywhere). When one stops being a baseline activity, its directory moves to the
// pack whose projects need it (#385 moved the git/GitHub and Claudinite-lifecycle
// skills out).
export default {
  // A migration record's declared `version` must be ≤ this number, and this number must
  // MOVE for that record to reach a member already at the previous one:
  // `migrationApplies` is `want > have` against the stamped version, and what gets
  // stamped is this manifest's number — so a record declaring a version above it would
  // re-apply every cycle, forever, draining never.
  version: '60830.1',
  minEngineVersion: '60822.1',
  ruleRoutingGuidance: {
    belongs: 'cross-project working discipline, issue-branch-PR lifecycle, repo hygiene, doc/reference integrity and the baseline engineering, testing and debugging skills',
    excludes: 'technology-specific content — its own tech pack; git procedure and GitHub Actions workflow or platform behaviour — git-github',
  },
  seededByDefault: true,
  // `core` is required rather than assumed: this pack is declared everywhere, so
  // the closure is what puts Claudinite's own rules in front of every session, and
  // `barriers` arrives with it. git-github carries the git/GitHub side of the task
  // lifecycle (#385).
  requires: ['claudinite-lifecycle', 'git-github'],
  // Rules that audit the repo as it stands, whatever this session did.
  // warning-suppression and rules-line-length are declared checks in this
  // pack's declared-checks.json, discovered structurally beside these.
  // Rules that judge the change and the session in front of you — the branch's
  // commits, the diff, the conversation. task-lifecycle and squash-merge-history
  // are declared checks carrying scope: "work", discovered structurally beside
  // these.
  // `task-janitor` and `ci-performance` are this pack's scheduled tasks,
  // discovered by the scheduler's filesystem scan (packs/claudinite-tasks/discover.mjs)
  // rather than declared here.
};
