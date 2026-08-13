import { patternRule } from '../../engine/checks/helpers/pattern-rules.mjs';
import { WORKFLOW_FILE } from '../../engine/checks/helpers/github-workflows.mjs';

const SCHEDULER = '.github/workflows/claudinite-scheduler.yml';

export default patternRule({
  id: 'gha/no-scheduled-fleet-executor',
  severity: 'blocking',
  description: 'The vendored claudinite-scheduler.yml is the repo\'s only permitted cron once present — a competing cron\'s work moves into a scheduler task and the workflow goes; before it is vendored, a Claudinite executor (one that calls a canon reusable) must be workflow_dispatch-only',
  doc: 'packs/basics/scheduled-tasks.md',
  why: 'a second cron competes with the one schedule the repo is meant to have — the per-repo scheduler, which owns every recurring Claudinite job',
  files: WORKFLOW_FILE,
  over: 'tracked',
  exclude: SCHEDULER,
  file: [
    {
      gate: { exists: SCHEDULER },
      forbid: /^\s*schedule:/m,
      what: 'carries a `schedule:` trigger, but the vendored claudinite-scheduler.yml is this repo\'s only permitted cron',
      fix: 'port this workflow\'s steps into the scheduler task that owns the work and delete the workflow in the same commit — after cutover a task IS the recurring unit, so do not leave a dispatch-only workflow behind for a task to fire (per-project-scheduling §3)',
    },
    {
      gate: { notExists: SCHEDULER },
      if: /uses:\s*\S*\/Claudinite\/\.github\/workflows\//i,
      forbid: /^\s*schedule:/m,
      what: 'a Claudinite executor (it calls a canon reusable workflow) carries a `schedule:` trigger',
      fix: 'remove the schedule: trigger — make it workflow_dispatch only, and adopt the vendored claudinite-scheduler.yml, which owns every recurring Claudinite job (packs/basics/scheduled-tasks.md)',
    },
  ],
});
