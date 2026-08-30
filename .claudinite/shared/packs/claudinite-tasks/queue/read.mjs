// Reading the queue. One rule, and it is load-bearing: the work-item list comes
// from the ISSUES list API, never the search index. Search is eventually
// consistent (S6/F11), and a family list that misses a just-created item is
// exactly how a second standing item — a double execution — gets minted.

import { WORK_PREFIX, ORIGIN_AD_HOC, STATUS_DONE, labelNames, statusOf } from './work-item.mjs';

// IS THIS ISSUE AN ITEM? Two shapes, and the second is what the one-issue request
// model added (DESIGN §16.1): a filed `[claudinite-work]` issue, or an ordinary
// issue somebody marked `task:origin:ad-hoc` that has been ADOPTED — the mark alone
// is a request awaiting adoption, not yet an item, and reading it as one would have
// the janitor's stateless-repair rule park the person's issue for having no status.
export const isQueueItem = (issue) =>
  String(issue?.title ?? '').startsWith(WORK_PREFIX)
  || (labelNames(issue).includes(ORIGIN_AD_HOC) && statusOf(issue) !== null);

const project = (i) => ({
  number: i.number,
  title: i.title,
  body: i.body ?? '',
  state: i.state,
  labels: labelNames(i),
  created_at: i.created_at,
  closed_at: i.closed_at ?? null,
  updated_at: i.updated_at,
});

// Every OPEN work item, oldest first. The whole queue is a page or two: a repo's
// standing items are one per scheduled task, plus whatever ad-hoc work exists.
export async function listOpenWorkItems(gh, repo) {
  const out = [];
  for (let page = 1; ; page += 1) {
    const { status, json } = await gh(`/repos/${repo}/issues?state=open&sort=created&direction=asc&per_page=100&page=${page}`);
    if (status !== 200 || !Array.isArray(json) || json.length === 0) break;
    for (const i of json) {
      if (i.pull_request) continue;
      if (!isQueueItem(i)) continue;
      out.push(project(i));
    }
    if (json.length < 100) break;
  }
  return out;
}

// Every work item that converged DONE, newest first — the closed half of the queue,
// and the only evidence the superseded-park rule (janitor rule E) runs on.
//
// BOUNDED, unlike the open list: a long-lived repo's closed set is thousands of
// issues and the rule only ever asks "did this task run clean since <park>". Two
// pages of most-recently-updated is far past the horizon of any park worth closing,
// and a park older than that is stale for reasons this rule is not the fix for.
export async function listDoneWorkItems(gh, repo, { pages = 2 } = {}) {
  const out = [];
  for (let page = 1; page <= pages; page += 1) {
    const { status, json } = await gh(`/repos/${repo}/issues?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`);
    if (status !== 200 || !Array.isArray(json) || json.length === 0) break;
    for (const i of json) {
      if (i.pull_request) continue;
      if (!isQueueItem(i)) continue;
      if (statusOf(i) !== STATUS_DONE) continue;
      out.push(project(i));
    }
    if (json.length < 100) break;
  }
  return out;
}
