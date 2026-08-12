import secretsInJobIf from './secrets-in-job-if.mjs';
import runPipefail from './run-pipefail.mjs';
import checkoutSubmodules from './checkout-submodules.mjs';
import scheduledFailureEscalation from './scheduled-failure-escalation.mjs';
import labelCreateBeforeAdd from './label-create-before-add.mjs';
import uniqueAutomationBranch from './unique-automation-branch.mjs';
import pagesArtifactSymlinks from './pages-artifact-symlinks.mjs';
import noScheduledFleetExecutor from './no-scheduled-fleet-executor.mjs';

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
  worldRules: [
    secretsInJobIf,
    runPipefail,
    checkoutSubmodules,
    scheduledFailureEscalation,
    labelCreateBeforeAdd,
    uniqueAutomationBranch,
    pagesArtifactSymlinks,
    noScheduledFleetExecutor,
  ],
  skills: ['github-actions-scheduling'],
};
