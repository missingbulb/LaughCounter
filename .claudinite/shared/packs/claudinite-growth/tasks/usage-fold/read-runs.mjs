// The usage fold's SECOND source: what the repo's own machinery did, per hour. The
// capture files say what happened inside a session; this says how often a session was
// started at all — and, more to the point, how often the scheduler ran and decided
// there was nothing to start.
//
// TWO WORKFLOWS, ONE LISTING EACH. The scheduler's runs and the executor's, filtered
// to completed ones, newest-first from the API and returned oldest-first so a
// truncated pass leaves a watermark the next fold continues from.
//
// IT READS NO JOB LOGS. Its predecessor did — two calls per run — to recover the slot
// scheduler's per-task records, and that writer is gone (#974): nothing has printed
// one since, so those calls now buy nothing at any cadence, let alone hourly. What a
// run DID with each task is read from the queue's own items instead (read-queue.mjs),
// which is the record that replaced it. So the cost here is two calls per fold, flat,
// however many runs are in the window.
//
// FORWARD-ONLY, past `runsFoldedThrough`, and only over COMPLETED runs — an
// in-progress run has no conclusion to count, and leaving the watermark behind it is
// what lets the next fold count it properly rather than as a run that never failed.
//
// FAIL-SOFT. An unreadable listing degrades this one source to "nothing new this run"
// and leaves the watermark where it was; the capture-derived counts do not depend on
// it and must not be lost with it.

import { SCHEDULER_WORKFLOW_FILE, EXECUTOR_WORKFLOW_FILE } from '../../../../engine/scheduler/signals/gh.mjs';

const API = process.env.GITHUB_API_URL || 'https://api.github.com';

// The two workflows and the name each is counted under in the hour rows. The words are
// the aggregate's own counter keys (`usage-format.mjs`), so they are spelled once.
export const WATCHED_WORKFLOWS = Object.freeze([
  { workflow: 'scheduler', file: SCHEDULER_WORKFLOW_FILE },
  { workflow: 'executor', file: EXECUTOR_WORKFLOW_FILE },
]);

// How far back the FIRST fold looks when the aggregate carries no run watermark yet.
// The hour tier is three days wide, so anything older would be read and immediately
// pruned.
export const FIRST_FOLD_LOOKBACK_DAYS = 3;

// A tiny REST reader — JSON only, since nothing here fetches a log any more.
// `fetchImpl` is injected so the tests drive it without a network.
export function makeReader({ token = process.env.GITHUB_TOKEN, api = API, fetchImpl = fetch } = {}) {
  const headers = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'claudinite-usage-fold',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
  return {
    async json(path) {
      const res = await fetchImpl(`${api}${path}`, { headers });
      if (res.status !== 200) return null;
      try { return await res.json(); } catch { return null; }
    },
  };
}

export const lookbackFrom = (nowIso, days = FIRST_FOLD_LOOKBACK_DAYS) =>
  new Date(new Date(nowIso).getTime() - days * 86400000).toISOString();

// One workflow's completed runs started strictly after `since`, oldest first.
export async function workflowRuns(reader, repo, file, { since, maxPages = 3 }) {
  const runs = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const path = `/repos/${repo}/actions/workflows/${file}/runs`
      + `?status=completed&per_page=100&page=${page}&created=%3E%3D${encodeURIComponent(String(since).slice(0, 10))}`;
    const json = await reader.json(path);
    const batch = json?.workflow_runs;
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const run of batch) {
      const at = run.run_started_at || run.created_at;
      if (!at || !run.id) continue;
      if (at <= since) continue;        // already folded (the `created` filter is day-grained)
      runs.push({ id: run.id, startedAt: at, conclusion: run.conclusion ?? null });
    }
    if (batch.length < 100) break;
  }
  return runs;
}

// The whole read: `{ runs, watermark, error? }`.
//   runs      — [{ startedAt, workflow, conclusion, id }], oldest first across both
//               workflows, so the hour rows accumulate in order.
//   watermark — the new `runsFoldedThrough`: the newest run start actually read, or
//               the old mark when nothing was read. One mark for both workflows, which
//               is safe because it only ever moves to a time both listings were read
//               past.
export async function readRuns({ reader, repo, since, now }) {
  const from = since || lookbackFrom(now);
  const runs = [];
  try {
    for (const { workflow, file } of WATCHED_WORKFLOWS) {
      for (const run of await workflowRuns(reader, repo, file, { since: from })) {
        runs.push({ ...run, workflow });
      }
    }
  } catch {
    return { runs: [], watermark: since, error: 'the workflow run listings could not be read' };
  }
  runs.sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : a.id - b.id));
  return { runs, watermark: runs.length ? runs[runs.length - 1].startedAt : since };
}
