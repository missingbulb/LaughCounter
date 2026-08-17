export default {
  id: 'github-actions',
  version: 1,
  minEngineVersion: 1,
  ruleRoutingGuidance: {
    belongs: 'workflow YAML and Actions runner platform behaviour: triggers, secrets, permissions, scheduling, artifacts, reusable workflows and their pitfalls',
    excludes: 'git and GitHub command procedure — git-github; release pipeline content for one product — its release pack',
  },
  badge: 'badge.svg',
  marker: '.github/workflows/*.ya?ml',
  detect: (ctx) => ctx.tracked.some((f) => /^\.github\/workflows\/.+\.ya?ml$/.test(f)),
  prose: null,
  worldRules: [],
  skills: ['github-actions-scheduling'],
};
