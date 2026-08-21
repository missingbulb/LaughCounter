// The schedule board (tasks-dispatch DESIGN §5, decision §15.28) — one open
// issue per repo, `[claudinite-schedule]`, whose body is a table with one row
// per scheduled task: the anchor it was last asked at, the verdict it gave and
// why. The scheduler run reads it as the watermark ("have I already asked this
// task about this occurrence?") and rewrites it only when a row changes.
//
// Parse/serialize of the board lives here and nowhere else, the way
// work-item.mjs owns the work item's schema. The board is a FIRST authority
// only for "asked at anchor A, declined"; frequency and the next window are
// derived from the declarations and `anchors.mjs` and re-rendered at every
// write. Durability is deliberately weak: a deleted, mangled or unreadable
// board degrades to "absent" per-row and costs one redundant evaluation —
// it fails toward evaluating, never toward skipping.
//
// The title prefix is disjoint from `[claudinite-work]` and `[claudinite-task]`
// on purpose: the board must never parse as a work item (the scheduler run's
// title-exact family match, `listOpenWorkItems`, the janitor) and never read
// as repo activity (the `issues` signal collector excludes all three prefixes).

import { nextAnchor } from './anchors.mjs';

export const SCHEDULE_PREFIX = '[claudinite-schedule]';

export const scheduleBoardTitle = () => `${SCHEDULE_PREFIX} the schedule board`;

export const isScheduleBoardTitle = (title) => String(title ?? '').startsWith(SCHEDULE_PREFIX);

// The verdict vocabulary a row may carry. Anything else parses as itself (a
// future writer's word must not break this reader) but only `no` ever gates:
// the watermark is scoped to declined rows (F31) — a `go` or `fail-open`
// verdict's cover is the item it created, and a go row honored as a gate
// would eat the occurrence whenever the item's own create failed after the
// row landed.
export const VERDICT_NO = 'no';
export const VERDICT_GO = 'go';
export const VERDICT_FAIL_OPEN = 'fail-open';

// ~64KB is the platform's issue-body cap; stay well under it so the write can
// never 422. Trivial at ~25 rows, budgeted anyway per the two-tier rule.
const BODY_BUDGET = 60_000;
const REASON_MAX = 160;

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// Render the whole board body from rows ({ task, frequency, lastAsked,
// verdict, reason }). `schedule` and `now` feed the derived next-window
// column, recomputed at every write — it is display, never data, which is why
// a stale one on a quiet row is harmless and why the change test upstream
// compares only the authoritative columns.
export function renderScheduleBoard(rows, { now = new Date(), schedule = null } = {}) {
  const sorted = [...rows].sort((a, b) => (a.task < b.task ? -1 : a.task > b.task ? 1 : 0));
  const header = [
    'One row per scheduled task: the anchor it was last asked at, the verdict, and why.',
    'The scheduler run reads this as its watermark — a declined occurrence is re-asked only at the task\'s next anchor — and files a work item only when a precondition says yes.',
    'Machine-maintained; edits are overwritten on the next change. Deleting this issue costs one redundant evaluation per task and nothing else.',
    '',
    '| task | frequency | last asked | verdict | reason | next window |',
    '|---|---|---|---|---|---|',
  ];
  const line = (r, reasonMax) => {
    let next = '';
    try {
      const n = r.frequency && r.frequency !== 'manual' && schedule !== undefined
        ? nextAnchor(r.frequency, schedule, now) : null;
      next = n ? n.toISOString() : '';
    } catch { next = ''; }
    return `| ${cell(r.task)} | ${cell(r.frequency)} | ${cell(r.lastAsked)} | ${cell(r.verdict)} | ${clip(cell(r.reason), reasonMax)} | ${next} |`;
  };
  const full = [...header, ...sorted.map((r) => line(r, REASON_MAX))].join('\n') + '\n';
  if (full.length <= BODY_BUDGET) return full;
  // Compact tier: every row survives with its reason dropped; rows that still
  // do not fit are counted rather than silently lost.
  const kept = [];
  let used = header.join('\n').length + 200; // slack for the omitted-count line
  for (const r of sorted) {
    const l = line(r, 0);
    if (used + l.length + 1 > BODY_BUDGET) break;
    kept.push(l);
    used += l.length + 1;
  }
  const omitted = sorted.length - kept.length;
  return [...header, ...kept,
    ...(omitted ? ['', `…and ${omitted} more row(s) omitted for size.`] : [])].join('\n') + '\n';
}

// Parse a board body back into rows. Tolerant per-row: a line that does not
// parse is simply skipped — a mangled row reads as absent for its task, which
// costs one redundant evaluation and nothing else. Never throws.
export function parseScheduleBoard(body) {
  const rows = new Map();
  for (const l of String(body ?? '').split('\n')) {
    const line = l.trim();
    if (!line.startsWith('|')) continue;
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.replace(/\\\|/g, '|').trim());
    if (cells.length < 5) continue;
    const [task, frequency, lastAsked, verdict, reason] = cells;
    if (!task || task === 'task' || /^-+$/.test(task)) continue; // header/separator
    if (!/^\S+\/\S+$/.test(task)) continue;
    rows.set(task, { task, frequency: frequency || null, lastAsked: lastAsked || null, verdict: verdict || null, reason: reason ?? '' });
  }
  return rows;
}

// The board issue, found by its exact title prefix over the OPEN issues list
// (the same REST-not-search rule as the work-item reads, S6/F11). More than
// one open board — a hand-created duplicate, or a torn create — resolves to
// the OLDEST, deterministically, so every run converges on the same one.
// A list that cannot be read answers `readable: false`: the caller evaluates
// fail-open AND skips the board write — never write what you could not read.
export async function findScheduleBoard(gh, repo) {
  for (let page = 1; ; page += 1) {
    const { status, json } = await gh(`/repos/${repo}/issues?state=open&sort=created&direction=asc&per_page=100&page=${page}`);
    if (status !== 200 || !Array.isArray(json)) return { readable: false, issue: null };
    for (const i of json) {
      if (i.pull_request) continue;
      if (isScheduleBoardTitle(i.title)) return { readable: true, issue: { number: i.number, body: i.body ?? '' } };
    }
    if (json.length < 100) return { readable: true, issue: null };
  }
}
