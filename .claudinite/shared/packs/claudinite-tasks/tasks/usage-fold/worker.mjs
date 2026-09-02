// The usage-fold code-work entry point — the script the executor runs as code-work,
// `node worker.mjs` (cwd = this task dir, bounded by code_work_timeout).
// The whole task: no agent phase.
//
// It holds NO counting logic. The counting and folding are `fold-usage.mjs`, its
// SIBLING in this task folder — nothing outside this task uses them, so that is
// where they live and where their tests point. This file is the I/O shell:
//
//   1. fetch the orphan `conversation-logs` branch (plain local git — the branch is
//      in this repo, so one tree read plus one blob read per file beats any REST
//      round-trip, and there is no rate budget to spend);
//   2. count each capture file still in the raw retention window;
//   3. list the scheduler's and executor's completed workflow runs past the
//      `runsFoldedThrough` watermark (read-runs.mjs) — how often the machinery ran,
//      including the runs that opened no session at all;
//   4. list the work items that CLOSED past the `queueFoldedThrough` watermark
//      (read-queue.mjs) — what each occurrence came to;
//   5. read the local git history and the releases listing for the day series neither
//      of the above can answer — commits, lines and releases;
//   6. fold: hour rows over the last three days, day rows recomputed from scratch,
//      appended rows past their watermarks, week rows advanced past `foldedThrough`
//      (skill-usage-metrics DESIGN §5);
//   7. deliver the regenerated `.claudinite/local/usage.GENERATED.json` on a PR
//      that lands itself where this repo's delivery settings allow (the shared
//      landing helper owns those nuances — packs/claudinite-tasks/land-pr.mjs) — and
//      open NOTHING when the recompute is byte-identical apart from its stamp.
//
// The aggregate lives under `.claudinite/local/` because that is the repo-owned area
// the vendoring refresh never touches; the mount root itself is read-only canon.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deliverGenerated, baseTip, readAt, remoteUrl } from '../../../claudinite-tasks/deliver-generated.mjs';
import { AUTOMERGE_TRAILER, policyExpression } from '../../../claudinite-tasks/merge-policy.mjs';
import task from './task.mjs';
import {
  countEntries, foldUsage, encodeUsage, decodeUsage, mountedSkillNames, DAY_WINDOW_DAYS,
} from './fold-usage.mjs';
import { renderUsageFile, withoutStamp } from './usage-format.mjs';
import { makeReader, readRuns } from './read-runs.mjs';
import { makeReader as makeQueueReader, readQueueOutcomes } from './read-queue.mjs';
import { settingsPath } from '../../../../engine/settings-file.mjs';

const BRANCH = 'conversation-logs';
export const USAGE_PATH = '.claudinite/local/usage.GENERATED.json';
const PR_BRANCH_PREFIX = 'claudinite/usage-fold';

const item = process.env.CLAUDINITE_ITEM || '';
const log = (s) => console.log(`usage-fold${item ? ` [#${item}]` : ''}: ${s}`);

const git = (root, args) => execFileSync('git', ['-C', root, ...args], {
  encoding: 'utf8',
  // A capture blob easily tops the default 1 MiB buffer — a long session's log then
  // dies mid-read and the day it lands in silently under-counts.
  maxBuffer: 256 * 1024 * 1024,
  stdio: ['ignore', 'pipe', 'pipe'],
});

// --- the raw window -----------------------------------------------------------

// The capture filename standard (packs/claudinite-growth/README.md). Issue `0`
// means "no associated issue" — a SessionEnd capture. Exported for the tests.
//
// The `stamp` is the same name read to the minute, which is what files the session
// into an HOUR row. The name is machine-written by the capture step, so reading the
// clock off it costs nothing and agrees with the retention rules that read it too.
export function parseLogName(name) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})Z(?:-\d+)?--issue-(\d+)--(.+)\.jsonl$/.exec(name);
  return m ? { date: m[1], stamp: `${m[1]}T${m[2]}:${m[3]}:00Z`, issue: Number(m[4]), sessionId: m[5] } : null;
}

export function parseEntries(text) {
  const out = [];
  for (const line of (text || '').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a partial trailing write — skip the line */ }
  }
  return out;
}

// Fetch the logs branch and return its capture files. Returns null when the branch
// does not exist — a repo that has never captured has nothing to fold, which is a
// clean no-op rather than a failure.
function logFiles(root, remote) {
  if (!git(root, ['ls-remote', '--heads', remote, BRANCH]).trim()) return null;
  git(root, ['fetch', '--quiet', remote, BRANCH]);
  const tip = git(root, ['rev-parse', 'FETCH_HEAD']).trim();
  const names = git(root, ['ls-tree', '--name-only', tip]).split('\n').filter(Boolean);
  return { tip, names: names.filter((n) => parseLogName(n) !== null).sort() };
}

// --- the day series the sessions cannot answer --------------------------------

// What landed, per day: commits on the base branch and the lines they moved. Local
// git, so it is free and recomputed every run — a counting fix heals the whole window
// the way the capture-derived rows do.
//
// A SHALLOW CHECKOUT IS THE NORMAL CASE in Actions, and it is why this returns a
// covered-from date rather than a map with zeroes in it: the history simply stops
// somewhere, and every day before that is UNKNOWN. Writing 0 for those days would
// draw a busy fortnight as an idle one, and the fold's own rule is that an absent
// source leaves no key at all.
//
// `COMMIT_MARK` opens each commit's block so the numstat lines that follow can be
// attributed to it. A control character rather than any printable prefix, because the
// only thing that can never appear at the start of a numstat line is something git
// cannot produce there. A merge commit shows no numstat and contributes a commit but
// no lines, which is right — its content arrived with the commits it merged.
const COMMIT_MARK = '\u0001';

export function parseCommitLog(text) {
  const days = {};
  let date = null;
  for (const line of String(text ?? '').split('\n')) {
    if (line.startsWith(COMMIT_MARK)) {
      date = line.slice(1, 11) || null;
      if (date) (days[date] ??= { commits: 0, linesAdded: 0, linesRemoved: 0 }).commits += 1;
      continue;
    }
    if (!date || !line.trim()) continue;
    const m = /^(\d+|-)\t(\d+|-)\t/.exec(line);
    if (!m) continue;
    // `-` is a binary file: it has no line count, and counting it as 0 is the honest
    // reading — no LINES moved, whatever the bytes did.
    if (m[1] !== '-') days[date].linesAdded += Number(m[1]);
    if (m[2] !== '-') days[date].linesRemoved += Number(m[2]);
  }
  return days;
}

export function commitSeries(git, root, sha, sinceIso) {
  let text = '';
  try {
    text = git(root, ['log', sha, `--since=${sinceIso}`, '--date=iso-strict', '--pretty=format:%x01%cI', '--numstat']);
  } catch {
    return null;                            // no readable history — the series is unknown, not empty
  }
  const days = parseCommitLog(text);
  // Where the available history actually starts. On a full clone that is the window;
  // on a shallow one it is wherever the fetch stopped, and days before it carry no key.
  let coveredFrom = sinceIso.slice(0, 10);
  try {
    if (git(root, ['rev-parse', '--is-shallow-repository']).trim() === 'true') {
      const oldest = git(root, ['log', sha, '--reverse', '--pretty=format:%cI']).split('\n')[0]?.slice(0, 10);
      if (oldest && oldest > coveredFrom) coveredFrom = oldest;
    }
  } catch { /* an older git without the flag — the window stands */ }
  return { days, coveredFrom };
}

// Releases published per day. One REST read, recomputed every run like the git series.
// Absent (unreadable) leaves every day without the key rather than claiming a month
// with no releases in it.
export async function releaseSeries(reader, repo) {
  const list = await reader.json(`/repos/${repo}/releases?per_page=100`);
  if (!Array.isArray(list)) return null;
  const days = {};
  for (const r of list) {
    const at = r?.published_at ?? r?.created_at;
    if (!at) continue;
    const date = String(at).slice(0, 10);
    days[date] = (days[date] ?? 0) + 1;
  }
  // Newest-first and capped at one page: a repo publishing more than 100 releases
  // inside the window would under-report the far end. Stated rather than silently
  // truncated — the caller logs it.
  return { days, truncated: list.length >= 100 };
}

// The two series above, merged into the per-day field map `foldUsage` takes: a day
// gets a key only from a source that could speak for it.
export function dayFieldsFrom({ commits = null, releases = null, ladder = [] }) {
  const out = {};
  for (const date of ladder) {
    const fields = {};
    if (commits && date >= commits.coveredFrom) {
      const row = commits.days[date] ?? { commits: 0, linesAdded: 0, linesRemoved: 0 };
      Object.assign(fields, row);
    }
    if (releases) fields.releases = releases.days[date] ?? 0;
    if (Object.keys(fields).length) out[date] = fields;
  }
  return out;
}

// The window's UTC days, oldest first.
export function dayLadder(nowIso, days = DAY_WINDOW_DAYS) {
  const end = new Date(`${nowIso.slice(0, 10)}T00:00:00Z`).getTime();
  return Array.from({ length: days }, (_, i) => new Date(end - (days - 1 - i) * 86400000).toISOString().slice(0, 10));
}

// --- main ---------------------------------------------------------------------

export async function main() {
  const root = process.env.CLAUDINITE_REPO_ROOT || process.cwd();
  const repo = process.env.CLAUDINITE_REPO || process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const base = process.env.CLAUDINITE_DEFAULT_BRANCH || 'main';
  if (!repo) throw new Error('CLAUDINITE_REPO / GITHUB_REPOSITORY is not set (owner/repo)');
  if (!token) throw new Error('GITHUB_TOKEN is not set — the fold cannot read the logs branch or deliver its PR');
  const remote = remoteUrl(repo, token);

  // No logs branch is no longer "nothing to do": the capture-derived half of the
  // aggregate is empty, but every other source — the run listings, the queue's own
  // closed items, the git history — exists as soon as the repo has a scheduler, and a
  // repo whose sessions are all unattended is exactly the one worth counting.
  const found = logFiles(root, remote);
  if (found === null) log(`no ${BRANCH} branch — nothing captured yet; folding the run, queue and git sources only`);

  let config = {};
  try { config = JSON.parse(readFileSync(settingsPath(root), 'utf8')); } catch { /* no declaration */ }
  const mounted = await mountedSkillNames(root, config);

  const files = (found?.names ?? []).map((name) => ({
    ...parseLogName(name),
    counts: countEntries(parseEntries(git(root, ['show', `${found.tip}:${name}`])), mounted),
  }));

  // Prior state comes from the BASE TIP, never the working tree: the checkout may be
  // sitting on another task's branch, and the base is the only authority on what has
  // already been folded. A fold PR still open when the next run fires is rebuilt from
  // the base — days recompute statelessly and the watermark advances from the same
  // place, so nothing is ever counted twice.
  const baseSha = baseTip(root, remote, base);
  // Decoded on the way in: the prior file may have been written by any version of this
  // format, and the fold works in named counters throughout.
  let prior = {};
  try { prior = decodeUsage(JSON.parse(readAt(root, baseSha, USAGE_PATH) ?? '{}')); } catch { /* unparsable → refold */ }

  const now = new Date().toISOString();
  const reader = makeReader({ token });

  // The outside sources. Each is INDEPENDENTLY fail-soft: one that cannot be read
  // costs its own rows this run and leaves its own watermark where it was, because
  // the capture-derived counts do not depend on any of them and must not be lost with
  // one of them.
  const runs = await readRuns({ reader, repo, since: prior.runsFoldedThrough ?? null, now });
  if (runs.error) log(`${runs.error} — the hour rows' run counts are unchanged this run`);

  const queue = await readQueueOutcomes({
    reader: makeQueueReader({ token }), repo, since: prior.queueFoldedThrough ?? null, now,
  });
  if (queue.error) log(`${queue.error} — the queue outcome rows are unchanged this run`);

  const ladder = dayLadder(now);
  const commits = commitSeries(git, root, baseSha, `${ladder[0]}T00:00:00Z`);
  if (commits === null) log('the local git history could not be read — the commit and line rows are absent this run');
  else if (commits.coveredFrom > ladder[0]) {
    log(`this checkout's history starts at ${commits.coveredFrom} — days before it carry no commit or line counts`);
  }
  const releases = await releaseSeries(reader, repo);
  if (releases === null) log('the releases listing could not be read — the release rows are absent this run');
  else if (releases.truncated) log('more than 100 releases exist — the far end of the release series may be under-counted');

  const today = now.slice(0, 10);
  const text = renderUsageFile(encodeUsage(foldUsage({
    files,
    prior,
    today,
    now,
    generated: now,
    runs: runs.runs,
    runsFoldedThrough: runs.watermark,
    queueRecords: queue.records,
    queueFoldedThrough: queue.watermark,
    dayFields: dayFieldsFrom({ commits, releases, ladder }),
  })));

  // Compared WITHOUT the freshness stamp, which moves every run by construction: a
  // repo where nothing happened must still open nothing, and the stamp is the one line
  // that would otherwise make every hourly fold a PR.
  const landed = readAt(root, baseSha, USAGE_PATH);
  if (landed !== null && withoutStamp(landed) === withoutStamp(text)) {
    log(`${files.length} capture file(s) folded — recompute is byte-identical, nothing to deliver`);
    return;
  }

  const pr = await deliverGenerated({
    root, repo, base, token, stamp: today, branchPrefix: PR_BRANCH_PREFIX, log,
    // Which task wrote this, stamped onto the branch commit and the merge commit:
    // the fold's own delivery must read as machinery, never as the repo moving.
    task: 'claudinite-tasks/usage-fold',
    files: { [USAGE_PATH]: text },
    // The arming trailer carries the task's own automerge, so the
    // automerge-policy-scope check re-measures this delivery's diff wherever the
    // PR's CI runs check_the_work — the code lane's equivalent of the agent
    // lane's stamp-before-merge.
    message: `Claudinite: fold usage metrics\n\n${AUTOMERGE_TRAILER}: ${policyExpression(task.automerge)}`,
    title: 'Claudinite: usage fold',
    body: [
      `Regenerated \`${USAGE_PATH}\` from this repo's captured conversation logs, its`,
      "workflow run listings, the queue's own closed work items, and its git history.",
      '',
      'Hour rows cover the last three days; day rows are recomputed from scratch every',
      'run from the sources still readable; week rows are appended once, past the',
      '`foldedThrough` watermark. The run and queue rows are appended once past their',
      'own watermarks — both are rate-limited REST reads, not a local branch.',
      'A recompute that differs only in its `generated` stamp opens no PR at all.',
      'Machine-written — never hand-edit it.',
    ].join('\n'),
  });
  log(`${files.length} capture file(s), ${runs.runs.length} run(s) and ${queue.records.length} closed item(s) folded — `
    + `${pr.reused ? 'updated' : 'opened'} PR ${pr.number !== null ? `#${pr.number}` : `on ${pr.branch}`}`
    + `${pr.merged ? ' (landed)' : pr.delivery === 'review' ? ' (left for review)' : ''}`);
}

// Run only when invoked directly (code-work's `node worker.mjs`), never on import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`usage-fold failed: ${e.message}`); process.exit(1); });
}
