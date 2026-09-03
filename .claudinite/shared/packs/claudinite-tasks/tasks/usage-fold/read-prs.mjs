// The usage fold's FOURTH source: what each merged pull request took.
//
// The dashboard's lead-time figures — issue → merged, session → merged, opened →
// merged — reach further back than one page of live issue reads, so they come from
// here. What this carries is DURATIONS, one row per merged PR, never percentiles: a
// week's p50 is not derivable from its days' p50s, so the quantile is the reader's
// reduction over whatever window it draws and the fold's job is to carry the sample.
//
// APPEND-ONCE past `prsFoldedThrough`, bounded on `merged_at` for the same reason the
// queue read is bounded on `closed_at`: a merge is settled and never moves, so an item
// is counted on the one fold that first sees it and never again.
//
// FAIL-SOFT per source, like every other read here: an unreadable listing costs the PR
// rows this run and leaves the mark where it was. A closing issue that cannot be read
// costs that one PR's `issueLeadHours` and nothing else.

import { lookbackFrom } from './read-queue.mjs';
// The two pure field derivations, in their own module so the page that shares them
// never loads this file's reader with them.
import { closesIssueIn, hoursBetween } from './pr-fields.mjs';

export { closesIssueIn, hoursBetween };

// The listing, plus one narrow read per merged PR that names a closing issue.
// `{ prs, watermark, error? }`.
export async function readMergedPrs({ reader, repo, since, now, maxPages = 5 }) {
  // The pulls endpoint takes no `since`, so the window is applied here: on a first read
  // with no mark, the day tier's own width, so one fold populates the whole window.
  const from = since || lookbackFrom(now);
  const prs = [];
  try {
    for (let page = 1; page <= maxPages; page += 1) {
      const batch = await reader.json(
        `/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`,
      );
      if (!Array.isArray(batch) || batch.length === 0) break;
      for (const pr of batch) {
        const mergedAt = pr?.merged_at ?? null;
        if (!mergedAt || mergedAt <= from) continue;
        prs.push({
          number: pr.number,
          mergedAt,
          createdAt: pr?.created_at ?? null,
          closesIssue: closesIssueIn(pr?.body),
          issueCreatedAt: null,
        });
      }
      if (batch.length < 100) break;
    }
  } catch {
    return { prs: [], watermark: since, error: 'the merged pull requests could not be listed' };
  }

  for (const pr of prs) {
    if (pr.closesIssue === null) continue;
    try {
      const issue = await reader.json(`/repos/${repo}/issues/${pr.closesIssue}`);
      pr.issueCreatedAt = issue?.created_at ?? null;
    } catch { /* one unreadable issue costs its own lead time and no other row */ }
  }

  const newest = prs.map((p) => p.mergedAt).sort().pop() ?? null;
  return { prs, watermark: newest ?? since ?? null };
}

// The listing and the capture files, joined into the day-row records `foldPrs` takes.
//
// `sessionToMergeHours` is the one figure neither source answers alone: the session
// that did the work is the capture file whose NAME carries the closing issue's number
// (the same join `merges` is counted on), and its earliest stamp is when that work
// started. A PR whose issue never captured — or whose capture has aged out of the logs
// branch's retention — has no session end, and the slot is `null` rather than a zero.
export function prRecordsFrom({ prs = [], files = [] }) {
  const started = new Map();
  for (const file of files) {
    if (!file?.stamp || !(file.issue > 0)) continue;
    const first = started.get(file.issue);
    if (first === undefined || file.stamp < first) started.set(file.issue, file.stamp);
  }
  return prs.map((pr) => ({
    date: pr.mergedAt.slice(0, 10),
    number: pr.number,
    leadHours: hoursBetween(pr.createdAt, pr.mergedAt),
    issueLeadHours: hoursBetween(pr.issueCreatedAt, pr.mergedAt),
    sessionToMergeHours: hoursBetween(started.get(pr.closesIssue) ?? null, pr.mergedAt),
  }));
}
