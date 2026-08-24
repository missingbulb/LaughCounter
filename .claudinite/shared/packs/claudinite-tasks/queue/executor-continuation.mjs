// THE CONTINUATION OF A DEAD EXECUTOR RUN (tasks-dispatch DESIGN §10, S36).
//
// A run that dies — crash, timeout, cancellation, runner loss — never reaches its
// own re-dispatch, so without this the queue would sit until the next scheduled
// tick. The platform runs the calling job on a FRESH runner after any such death,
// and this fires that dispatch instead: the remainder drains in ~a minute, while
// the dead run's OWN item waits for the executing leash to reclaim it — nothing
// here touches that item.
//
// `continuation_depth` is the stop. A run that dies at startup — a broken engine,
// a revoked token — dies identically every time, and an unguarded continuation
// would dispatch itself for as long as that lasts. After MAX_DEPTH the chain
// stops and SAYS SO on the repo's workflow-failure issue: a queue that has quietly
// stopped draining is the one failure nothing else here would surface, since every
// individual run looks like an ordinary death.

import { pathToFileURL } from 'node:url';
import { makeGh, actionRepoContext, EXECUTOR_WORKFLOW_FILE } from '../signals/gh.mjs';
import { dispatchWorkflow } from '../github.mjs';
import { reportWorkflowFailure, runUrl } from './workflow-failure.mjs';

export const MAX_DEPTH = 3;

export const CHAIN_FAILURE_TITLE = 'Claudinite executor chain failed repeatedly';

// An absent, empty or unparseable depth is depth 0 — the first death in a chain.
// It must never read as a large number, which would silence the continuation
// exactly when the queue most needs it.
export const nextDepth = (raw) => {
  const n = Number(String(raw ?? '').trim());
  return (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0) + 1;
};

// The decision, separated from the CLI shell so it tests against a fake `gh`.
// Resolves to the continuation it made; throws when the chain is over, which is
// what turns the calling job red.
export async function continueOrEscalate(gh, repo, defaultBranch, depth) {
  if (depth <= MAX_DEPTH) {
    const { ok, status } = await dispatchWorkflow(gh, repo, EXECUTOR_WORKFLOW_FILE, defaultBranch,
      { continuation_depth: String(depth) });
    if (!ok) throw new Error(`could not continue the chain on ${defaultBranch}: ${status}`);
    console.log(`- the executor run died — dispatched a fresh one on ${defaultBranch} (continuation ${depth} of ${MAX_DEPTH})`);
    return { continued: depth };
  }

  // The chain has died MAX_DEPTH times running: this is not one bad runner, and
  // dispatching another would spend the day proving it. Escalate to the same
  // one-open-issue surface the scheduler's own failures use, and let the next
  // scheduled tick be what tries again.
  const { issue, created } = await reportWorkflowFailure(gh, repo, {
    title: CHAIN_FAILURE_TITLE,
    body: `${MAX_DEPTH} consecutive executor runs died before finishing their item.`
      + ' The chain stops here; the next scheduled scheduler run will dispatch a fresh one.'
      + `\n\nThe last run: ${runUrl()}`,
  });
  console.log(`- ${created ? 'filed' : 'commented on'} #${issue}`);
  throw new Error(`the executor chain died ${MAX_DEPTH} times in a row — escalated`);
}

async function main() {
  const { repo, defaultBranch } = actionRepoContext();
  if (!repo) throw new Error('GITHUB_REPOSITORY is not set');
  await continueOrEscalate(makeGh(), repo, defaultBranch, nextDepth(process.env.CLAUDINITE_CONTINUATION_DEPTH));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
}
