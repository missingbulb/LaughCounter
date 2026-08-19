// The two operator levers (tasks-dispatch DESIGN §8), which are the whole of
// urgency, forcing, fan-out and retry:
//
//   create-work-item <pack>/<task> [--urgent] [--context …] [--not-before ISO]
//                                  [--blocked-by #N,#M] [--qualifier text]
//                                  [--supersedes #N]
//   create-work-item --wake <#N> [--urgent]
//
// FORCING A SCHEDULED TASK IS WAKING ITS STANDING ITEM — strip `task:blocked`,
// clear `Not-before`, optionally add `task:urgent`. The same lever as the human
// re-queue out of `needs-human`, which is no accident: "run this now" and "retry
// this now" are the same operation on the same object. The executor still
// evaluates the precondition at pick, so a force that finds no work SAYS so where
// the operator reads it. The slot scheduler's whole forcing apparatus — its override
// bag, the forced-verdict path, the `~f` slot marker and the watermark exclusion —
// reduced to these two levers and was deleted (#974).
//
// FORCING AD-HOC WORK IS CREATING AN ITEM — a parameterized run, a `manual` task,
// a fan-out target. It carries no `origin:schedule`, so it is invisible to the
// tick's guards in both directions: it neither suppresses tomorrow's occurrence
// nor consumes it.

import { pathToFileURL } from 'node:url';
import {
  READY, BLOCKED, URGENT, NEEDS_HUMAN, OUTCOME_OBSOLETE, QUEUE_LABELS,
  EPISODE_MARKER, workItemTitle, workItemBody, withNotBefore, hasLabel,
} from './work-item.mjs';

// The Context a hand-created item carries when the operator names none. Generic
// on purpose — it names the mechanism, not the task — because an item's Context is
// the agent's binding scope, and a forced item that carried none would read as a
// scope of nothing.
export const FORCED_CONTEXT =
  'Created by hand — no precondition asserts there is work to do. Do only what the task file specifies, and converge to a no-op if there is nothing.';

export function parseArgs(argv) {
  const out = { urgent: false, context: [], blockedBy: [], notBefore: null, qualifier: null, supersedes: null, wake: null, target: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--urgent') out.urgent = true;
    else if (a === '--wake') out.wake = Number(String(next()).replace('#', ''));
    else if (a === '--context') out.context.push(next());
    else if (a === '--not-before') out.notBefore = next();
    else if (a === '--qualifier') out.qualifier = next();
    else if (a === '--supersedes') out.supersedes = Number(String(next()).replace('#', ''));
    else if (a === '--blocked-by') out.blockedBy.push(...String(next()).split(',').map((s) => Number(s.trim().replace('#', ''))).filter(Boolean));
    else if (!a.startsWith('--')) out.target = a;
  }
  return out;
}

// Wake an item: clear its wait and put it back in the queue. Also the sanctioned
// road back from `needs-human` — nothing MECHANICAL ever re-queues a triage item,
// and the next pickup re-runs the precondition, which is what makes the retry safe
// even when the failed run half-did its work.
export async function wakeItem(gh, repo, number, { urgent = false } = {}) {
  const api = await import('../github.mjs');
  const issue = await api.readIssue(gh, repo, number);
  if (!issue) return { ok: false, error: `#${number} could not be read` };
  const body = withNotBefore(issue.body ?? '', null);
  if (body !== issue.body) await gh(`/repos/${repo}/issues/${number}`, { method: 'PATCH', body: { body } });
  // The episode boundary: every claim before this moment is dead, and arbitrating
  // over dead claims is what livelocks an item through reclaim cycles forever.
  await api.comment(gh, repo, number, `${EPISODE_MARKER}\nWoken by hand — cleared \`Not-before\` and returned this item to the queue.`);
  for (const l of [BLOCKED, NEEDS_HUMAN]) if (hasLabel(issue, l)) await api.removeLabel(gh, repo, number, l);
  await api.addLabel(gh, repo, number, READY);
  if (urgent) await api.addLabel(gh, repo, number, URGENT);
  return { ok: true, number };
}

export async function createWorkItem(gh, repo, { pack, task, taskPath, opts, log = console.log }) {
  const api = await import('../github.mjs');
  const { listOpenWorkItems } = await import('./read.mjs');
  const title = workItemTitle({ pack, task, qualifier: opts.qualifier });

  // The pick-time mutex means a new item QUEUES behind an open twin rather than
  // running beside it, and the operator should know they are queueing, not jumping.
  const twin = (await listOpenWorkItems(gh, repo)).find((i) => (i.title ?? '').trim() === title);
  if (twin) log(`! #${twin.number} is an open item with this exact title — the new item will queue behind it, not run beside it`);

  await api.ensureLabels(gh, repo, QUEUE_LABELS);
  const blocked = opts.notBefore !== null || opts.blockedBy.length > 0;
  const res = await api.createIssue(gh, repo, {
    title,
    body: workItemBody({
      taskPath,
      notBefore: opts.notBefore,
      blockedBy: opts.blockedBy,
      context: opts.context.length ? opts.context : [FORCED_CONTEXT],
    }),
    labels: [blocked ? BLOCKED : READY, ...(opts.urgent ? [URGENT] : [])],
  });
  if (!res.number) return { ok: false, error: `could not create the item: ${res.status}` };

  if (opts.supersedes) {
    await api.comment(gh, repo, opts.supersedes, `Superseded by #${res.number}, a retry of this work created by hand.`);
    await api.addLabel(gh, repo, opts.supersedes, OUTCOME_OBSOLETE);
    await api.closeIssue(gh, repo, opts.supersedes, 'not_planned');
  }
  return { ok: true, number: res.number };
}

async function main() {
  const { makeGh, actionRepoContext } = await import('../signals/gh.mjs');
  const { discoverTasks } = await import('../discover.mjs');
  const { loadConfig } = await import('../../checks/helpers/repo-context.mjs');

  const opts = parseArgs(process.argv.slice(2));
  const { repo } = actionRepoContext();
  if (!repo) { console.error('GITHUB_REPOSITORY not set'); process.exit(1); }
  const gh = makeGh();

  if (opts.wake) {
    const res = await wakeItem(gh, repo, opts.wake, { urgent: opts.urgent });
    if (!res.ok) { console.error(res.error); process.exit(1); }
    console.log(`woke #${opts.wake}${opts.urgent ? ' (urgent)' : ''}`);
    return;
  }
  if (!opts.target || !opts.target.includes('/')) {
    console.error('usage: create-work-item <pack>/<task> [--urgent] [--context …] [--not-before ISO] [--blocked-by #N] [--qualifier text] [--supersedes #N]\n       create-work-item --wake <#N> [--urgent]');
    process.exit(1);
  }
  const [pack, task] = opts.target.split('/');
  const root = process.cwd();
  const { tasks } = await discoverTasks(root, loadConfig(root));
  const found = tasks.find((t) => t.pack === pack && t.id === task);
  if (!found) { console.error(`no task "${opts.target}" in this repo's declared packs`); process.exit(1); }

  const res = await createWorkItem(gh, repo, { pack, task, taskPath: found.taskPath, opts });
  if (!res.ok) { console.error(res.error); process.exit(1); }
  console.log(`created #${res.number} ${opts.target}${opts.urgent ? ' (urgent)' : ''}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
