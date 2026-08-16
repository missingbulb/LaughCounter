// Reading the queue. One rule, and it is load-bearing: the work-item list comes
// from the ISSUES list API, never the search index. Search is eventually
// consistent (S6/F11), and a family list that misses a just-created item is
// exactly how a second standing item — a double execution — gets minted.

import { WORK_PREFIX, labelNames } from './work-item.mjs';

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
      if (!(i.title ?? '').startsWith(WORK_PREFIX)) continue;
      out.push(project(i));
    }
    if (json.length < 100) break;
  }
  return out;
}
