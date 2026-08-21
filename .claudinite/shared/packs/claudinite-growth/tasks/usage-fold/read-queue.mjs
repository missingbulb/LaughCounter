// The usage fold's THIRD source: what each scheduled occurrence actually came to.
//
// The slot scheduler used to print that per due task into its own Actions log, and the
// fold counted those lines. That writer retired with the slot scheduler (#974) and the
// queue does not print an equivalent — because it does not need to. Every occurrence
// is a work ITEM, and when it converges it closes wearing an `outcome:*` label. The
// record is better than the log line was (it survives Actions retention, it is
// clickable, and it carries the task on its own title) and it is a different read,
// which is what #994 asked for. This module is that read.
//
// APPEND-ONCE past `queueFoldedThrough`, for the same reason the run listing is
// forward-only: this is a paged REST resource where the capture files are local git.
// It is safe to append rather than recompute because a CLOSED item is settled — the
// outcome label is written at convergence and nothing later moves it — so an item is
// counted on the one fold that first sees it closed and never again.
//
// The boundary is `closed_at`, not `updated_at`: the listing is asked for everything
// touched since the mark (a comment on an old item counts as a touch), and only items
// that closed past the mark are counted. Closing happens in real time, so the mark is
// monotone and the filter is exactly-once.
//
// FAIL-SOFT, like every other source here: an unreadable listing costs the queue rows
// this run and leaves the mark where it was.

// One definition of what a work item is, shared with the queue's own reader — a filed
// `[claudinite-work]` issue OR an adopted marked issue, which keeps the person's title.
import { isQueueItem } from '../../../../engine/scheduler/queue/read.mjs';
import {
  parseWorkItemTitle, parseWorkItemBody, taskIdFromPath, outcomeOf,
} from '../../../../engine/scheduler/queue/work-item.mjs';

const API = process.env.GITHUB_API_URL || 'https://api.github.com';

// How far back the FIRST read looks with no mark yet — the day tier's own width, so
// one fold populates the whole window rather than starting it empty.
export const FIRST_READ_LOOKBACK_DAYS = 30;

export const lookbackFrom = (nowIso, days = FIRST_READ_LOOKBACK_DAYS) =>
  new Date(new Date(nowIso).getTime() - days * 86400000).toISOString();

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

// The task an item belongs to. A filed item says so in its title; an ADOPTED marked
// issue keeps the person's own title and says so in the machine block its body carries
// — the same two-step the dashboard's own reader makes, so a request-shaped run is not
// silently counted as belonging to no task.
export function taskOf(issue) {
  const fromTitle = parseWorkItemTitle(issue?.title);
  if (fromTitle) return { pack: fromTitle.pack, task: fromTitle.task };
  const fromBody = taskIdFromPath(parseWorkItemBody(issue?.body).taskPath);
  return fromBody ? { pack: fromBody.pack, task: fromBody.task } : null;
}

// One closed item → a record, or null when it is not this fold's business.
export function recordFor(issue, since) {
  if (!isQueueItem(issue)) return null;
  const closedAt = issue?.closed_at ?? null;
  if (!closedAt) return null;
  if (since && closedAt <= since) return null;
  const task = taskOf(issue);
  if (!task) return null;
  return { date: closedAt.slice(0, 10), closedAt, ...task, outcome: outcomeOf(issue) ?? 'none' };
}

// The whole read: `{ records, watermark, error? }`.
export async function readQueueOutcomes({ reader, repo, since, now, maxPages = 5 }) {
  const from = since || lookbackFrom(now);
  const records = [];
  try {
    for (let page = 1; page <= maxPages; page += 1) {
      const path = `/repos/${repo}/issues?state=closed&sort=updated&direction=desc`
        + `&since=${encodeURIComponent(from)}&per_page=100&page=${page}`;
      const batch = await reader.json(path);
      if (!Array.isArray(batch) || batch.length === 0) break;
      for (const issue of batch) {
        if (issue?.pull_request) continue;         // the issues endpoint answers with both
        const rec = recordFor(issue, since);
        if (rec) records.push(rec);
      }
      if (batch.length < 100) break;
    }
  } catch {
    return { records: [], watermark: since, error: 'the closed work items could not be listed' };
  }
  const newest = records.map((r) => r.closedAt).sort().pop() ?? null;
  return { records, watermark: newest ?? since ?? null };
}
