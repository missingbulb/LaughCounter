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
  marker: '.github/workflows/*.ya?ml',
  detect: (ctx) => ctx.tracked.some((f) => /^\.github\/workflows\/.+\.ya?ml$/.test(f)),
  prose: null,
  rules: [
    secretsInJobIf,
    runPipefail,
    checkoutSubmodules,
    scheduledFailureEscalation,
    labelCreateBeforeAdd,
    uniqueAutomationBranch,
    pagesArtifactSymlinks,
    noScheduledFleetExecutor,
  ],
};
