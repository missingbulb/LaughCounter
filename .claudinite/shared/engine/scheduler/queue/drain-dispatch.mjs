// THE POST-SCHEDULER-RUN DRAIN (tasks-dispatch DESIGN §10, §15.16, §15.30). The
// scheduler run's own concurrency group serializes scheduler runs — its
// duplicate-standing-item self-heal depends on exactly that — and a drain running
// inside the group would make each tick queue behind the previous one's work,
// which the heartbeat, by making long work legal, turned from theoretical into
// likely. So the drain DISPATCHES the executor workflow rather than being one: it
// starts in its own group, on its own runner, and this step's success means "the
// drain was started", never "the drain finished".
//
// This is the guaranteed delivery. A `task:ready` label event may be lost; this
// fires on every tick that left something pickable, so a lost event is latency
// lost and never work lost.
//
// The workflow gates this step on the scheduler run's own `pickable` output — an
// executor dispatched into an empty queue costs a full billed invocation to find
// nothing. That gate weakens no delivery: what a lost label event would have
// delivered is exactly what the scheduler run's parting look already saw.

import { pathToFileURL } from 'node:url';
import { makeGh, actionRepoContext, EXECUTOR_WORKFLOW_FILE } from '../signals/gh.mjs';
import { dispatchWorkflow } from '../github.mjs';

async function main() {
  const { repo, defaultBranch } = actionRepoContext();
  if (!repo) throw new Error('GITHUB_REPOSITORY is not set');
  const { ok, status } = await dispatchWorkflow(makeGh(), repo, EXECUTOR_WORKFLOW_FILE, defaultBranch);
  // Judged by status, never by the body: a token without `actions: write` 403s
  // this POST with a plausible JSON body, and a run that logged `ok` for it would
  // leave the queue undrained with nothing saying so.
  if (!ok) throw new Error(`could not dispatch ${EXECUTOR_WORKFLOW_FILE} on ${defaultBranch}: ${status}`);
  console.log(`- dispatched the executor on ${defaultBranch} to drain whatever this scheduler run created`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
