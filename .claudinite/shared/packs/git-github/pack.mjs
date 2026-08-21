// The git/GitHub domain pack: the procedures and owner commands for the
// git/GitHub side of the task lifecycle, bundled as skills
// (skills/git-github-advanced, skills/merge-to-main), plus the workflow-YAML and
// Actions-runner rules — the `gha/` declared checks and the
// skills/github-actions-scheduling skill. Universal reach comes from basics
// naming it in `requires`, so the closure materializes it into every
// declaration — never seeded directly (#385).
//
// THE ACTIONS HALF CARRIES NO FINGERPRINT, and does not need one: every `gha/`
// check selects its inputs with `scanFiles` over `.github/workflows/`, so a repo
// with no workflows hears from none of them. The fingerprint the separate pack
// carried was a second copy of that same fact, kept in a place a repo had to
// re-declare (#1079).
export default {
  id: 'git-github',
  version: '60821.1',
  minEngineVersion: 1,
  ruleRoutingGuidance: {
    belongs: 'git and GitHub procedure and platform: commit layering, branch and merge mechanics, workflow YAML, triggers, secrets, scheduling',
    excludes: 'the issue-branch-PR lifecycle rules themselves — basics; release pipeline content for one product — its release pack',
  },
  badge: 'badge.svg',
  detect: null,
  marker: null,
  prose: null,
  // The `gha/` rules are declared checks, discovered structurally beside this
  // manifest (declared-checks.json). The lifecycle checks stay in basics.
  worldRules: [],
  skills: [
    'git-github-advanced',
    'github-actions-scheduling',
    'merge-to-main',
  ],
};
