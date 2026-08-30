// The repo tidy-up, as a composable pack: the PR/issue sweep and the comment pass
// the repo's own scheduler runs, contributed the same way any pack contributes checks and skills.
// Declaring tidy-repo puts its scheduled task on that repo's schedule; removing it
// is a durable opt-out (baselining never re-adds it — see the tidy-repo-seed
// migration).
//
// A declared pack (no detect fingerprint): --init seeds it into every new repo's
// declaration, and the one-time tidy-repo-seed migration seeds the existing fleet.
// It carries no conformance checks — its work is the scheduled tasks — but the
// improve-comments skill owns the gate that bounds the one task writing the source.
//
// One task per dimension — tidy-issues (daily, acts), tidy-prs (weekly,
// assess-only), improve-comments (weekly, acts on the source) — each delegating its
// verdict to a skill of its own, and the two GitHub-object ones reconciling their
// OWN standing tracker. Narrow tasks, not one wide one: each has its own trigger and
// scope, none depends on another's result, so there is no ordering barrier and a
// dimension with nothing to do stays silent.
export default {
  version: '60830.2',
  minEngineVersion: '60822.1',
  ruleRoutingGuidance: {
    belongs: 'housekeeping of one repo — triage verdicts over its issues and pull requests, the comments in its source, standing trackers',
    excludes: 'extracting lessons into packs — that is claudinite-growth; cross-repo fleet sweeps are claudinite-fleet-sheepdog',
  },
  seededByDefault: true,
  // The pack's scheduled tasks live in this pack's own `tasks/<id>/`, discovered by
  // the scheduler's filesystem scan (packs/claudinite-tasks/discover.mjs), not declared here.
  //
  // The worker skills those tasks apply live under this pack's own skills/ and mount
  // wherever tidy-repo is declared; improve-comments' also carries the check that
  // bounds its task's write surface.
};
