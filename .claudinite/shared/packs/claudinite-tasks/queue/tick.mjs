// COMPATIBILITY ENTRY POINT — "the tick" was renamed to the scheduler run (#877),
// and the mechanism now lives in `scheduler-run.mjs` beside this file. Nothing in
// the canon imports this path.
//
// WHY IT MUST EXIST. A member's `.github/workflows/claudinite-scheduler.yml` names
// the module it runs as a literal path, and that file is the ONE path a converge
// cannot push: it lands as a pull request the member has to merge, on its own
// cycle, while the mount beside it refreshes nightly. So every member spends a
// window running the new mount from an old workflow — and a workflow whose
// `node .claudinite/shared/packs/claudinite-tasks/queue/tick.mjs` finds nothing is a
// repo whose whole queue stops, silently, with no run left to fix it.
//
// WHEN IT GOES. When no member's `.github/workflows/claudinite-scheduler.yml`
// still names this path — read the members' workflow files, do not guess a date.

import { runSchedulerRun } from './scheduler-run.mjs';

console.log('- invoked as `tick.mjs`, which is the old name for the scheduler run —'
  + ' this repo\'s scheduler workflow is behind the mount and should be re-converged');
runSchedulerRun().catch((e) => { console.error(e); process.exit(1); });
