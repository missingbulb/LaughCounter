import { finding } from '../../engine/checks/helpers/findings.mjs';
import { workflowFiles } from '../../engine/checks/helpers/github-workflows.mjs';

// The fleet daily routine is the only schedule (routines/fleet/scheduling.md): the
// census, the sweep, and every pack task's Action are workflow_dispatch-only executors
// it triggers. A workflow that calls a Claudinite canon reusable workflow is such an
// executor; if it also carries a `schedule:` trigger it becomes a second orchestrator
// with a competing cron. A consumer's own unrelated scheduled workflow (no Claudinite
// reusable) is deliberately not flagged.
const rule = {
  id: 'gha/no-scheduled-fleet-executor',
  severity: 'blocking',
  description: 'A Claudinite executor workflow (one that calls a canon reusable) must be workflow_dispatch-only, never scheduled',
  doc: 'routines/fleet/scheduling.md',
  why: 'a scheduled executor is a second orchestrator competing with the fleet daily routine, which is meant to be the one schedule',

  run(ctx) {
    const out = [];
    for (const wf of workflowFiles(ctx)) {
      const text = ctx.read(wf);
      if (text === null) continue;
      if (!/^\s*schedule:/m.test(text)) continue;
      if (!/uses:\s*\S*\/Claudinite\/\.github\/workflows\//i.test(text)) continue;
      out.push(finding(rule, {
        file: wf,
        what: 'a Claudinite executor (it calls a canon reusable workflow) carries a `schedule:` trigger',
        fix: 'remove the schedule: trigger — make it workflow_dispatch only; the fleet daily routine is the only schedule (routines/fleet/scheduling.md)',
      }));
    }
    return out;
  },
};

export default rule;
