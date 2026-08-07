// The task-janitor's prework — the whole task (agent_model: none). The ONE
// home of dispatch-issue recovery and health review, moved out of the
// scheduler's hourly run (owner, 2026-08-06: scheduler creates, executor
// executes its one issue, janitor cleans up). This file is the I/O shell; the
// verdicts are the pure rules in the vendored engine (dispatch.mjs), so what
// counts as stale, dead or lost is decided in exactly one place.
//
// Three backstops, in this order:
//   1. STALE — a dispatch open past ~2 of its own scheduling periods →
//      escalation comment, drop the ready label, add `needs-human`. Once — an
//      already-escalated issue is never re-announced.
//   2. DEAD CLAIM — `agent-running` with no activity for ~3h → the session that
//      claimed it died; comment, drop `agent-running`, add `needs-human`.
//   3. RE-ARM — armed but untouched past the grace window → the trigger event
//      was lost, so remove and re-add its ready label to emit a fresh one.
// Stale wins over re-arm, so an issue converging to triage is never put back
// into circulation.
//
// The daily cadence is a stated trade (it was hourly when it lived in the
// scheduler): a lost trigger event or a dead claim now waits up to a day for
// recovery. That is the price of the responsibility split, and the owner chose
// it — recurring recovery is cleanup, and cleanup is nobody's job but this one.
//
// It ends with a HEALTH REVIEW: one line per open dispatch state, so the run
// log answers "how is the task machinery doing" at a glance.

import { pathToFileURL } from 'node:url';
import {
  staleDispatchIssues, staleEscalationComment, staleClaimedDispatchIssues, staleClaimComment,
  rearmDispatchIssues, readyLabelOn, DISPATCH_PREFIX, NEEDS_HUMAN_LABEL, AGENT_RUNNING_LABEL,
  SCHEDULER_LABELS,
} from '../../../../engine/scheduler/dispatch.mjs';
import { makeGh } from '../../../../engine/scheduler/signals/gh.mjs';
import { ensureLabels } from '../../../../engine/scheduler/run.mjs';

const slotId = process.env.CLAUDINITE_SLOT_ID || '';
const log = (s) => console.log(`task-janitor${slotId ? ` [${slotId}]` : ''}: ${s}`);

// Every OPEN dispatch issue in the repo, with the labels / age / comment count
// the rules read. Repo-wide and open-only — the scheduler's own per-family
// state=all search (its filing guards) is a different question.
export async function openDispatchIssues(gh, repo) {
  const q = encodeURIComponent(`repo:${repo} is:issue is:open in:title "${DISPATCH_PREFIX}"`);
  const { status, json } = await gh(`/search/issues?q=${q}&per_page=100`);
  if (status !== 200 || !Array.isArray(json?.items)) {
    throw new Error(`could not list open dispatch issues: search returned ${status}`);
  }
  return json.items.map((i) => ({
    number: i.number, title: i.title, labels: i.labels ?? [],
    created_at: i.created_at, updated_at: i.updated_at, comments: i.comments ?? 0,
  }));
}

// The sweep, injectable for tests: `gh` is the Action-token REST client.
export async function sweep(gh, repo, now) {
  const open = await openDispatchIssues(gh, repo);
  const result = { open: open.length, stale: [], deadClaims: [], rearmed: [] };
  const stale = staleDispatchIssues(open, now);
  const staleNumbers = new Set(stale.map((i) => i.number));
  const deadClaims = staleClaimedDispatchIssues(open, now).filter((i) => !staleNumbers.has(i.number));
  const rearm = rearmDispatchIssues(open, now);

  if (stale.length || deadClaims.length || rearm.length) {
    // Applying a label 422s when it does not exist, so guarantee them first — a
    // quiet repo never gets here, so this costs nothing on the common path.
    await ensureLabels(gh, repo, SCHEDULER_LABELS);
  }

  const escalate = async (issue, body, dropLabel) => {
    await gh(`/repos/${repo}/issues/${issue.number}/comments`, { method: 'POST', body: { body } });
    if (dropLabel) await gh(`/repos/${repo}/issues/${issue.number}/labels/${encodeURIComponent(dropLabel)}`, { method: 'DELETE' });
    await gh(`/repos/${repo}/issues/${issue.number}/labels`, { method: 'POST', body: { labels: [NEEDS_HUMAN_LABEL] } });
  };

  for (const issue of stale) {
    await escalate(issue, staleEscalationComment(issue), readyLabelOn(issue));
    log(`escalated stale dispatch #${issue.number} to ${NEEDS_HUMAN_LABEL}`);
    result.stale.push(issue.number);
  }
  for (const issue of deadClaims) {
    await escalate(issue, staleClaimComment(issue), AGENT_RUNNING_LABEL);
    log(`reclaimed dead ${AGENT_RUNNING_LABEL} claim on #${issue.number} → ${NEEDS_HUMAN_LABEL}`);
    result.deadClaims.push(issue.number);
  }
  for (const issue of rearm) {
    const ready = readyLabelOn(issue);
    const del = await gh(`/repos/${repo}/issues/${issue.number}/labels/${encodeURIComponent(ready)}`, { method: 'DELETE' });
    if (del.status >= 300) { log(`! could not un-label #${issue.number} to re-arm it: ${del.status}`); continue; }
    const add = await gh(`/repos/${repo}/issues/${issue.number}/labels`, { method: 'POST', body: { labels: [ready] } });
    if (add.status >= 300) log(`! re-arm of #${issue.number} dropped its ${ready} label: ${add.status}`);
    else { log(`re-armed #${issue.number} (${ready}) — its trigger event never landed`); result.rearmed.push(issue.number); }
  }

  // The health review — the "reviews status, assesses health" half. Counts are
  // over the post-sweep label states as this run leaves them.
  const names = (i) => (i.labels ?? []).map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean);
  const converged = new Set([...result.stale, ...result.deadClaims]);
  const armed = open.filter((i) => readyLabelOn(i) && !converged.has(i.number)).length;
  const running = open.filter((i) => names(i).includes(AGENT_RUNNING_LABEL) && !converged.has(i.number)).length;
  const needsHuman = open.filter((i) => names(i).includes(NEEDS_HUMAN_LABEL)).length + converged.size;
  log(`health: ${result.open} open dispatch issue(s) — ${armed} armed, ${running} running, ${needsHuman} needs-human; `
    + `this run escalated ${result.stale.length}, reclaimed ${result.deadClaims.length}, re-armed ${result.rearmed.length}`);
  return result;
}

export async function main() {
  const repo = process.env.CLAUDINITE_REPO || process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error('CLAUDINITE_REPO / GITHUB_REPOSITORY is not set (owner/repo)');
  if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is not set — the janitor cannot read or write issues');
  await sweep(makeGh(), repo, new Date());
}

// Run only when invoked directly (the scheduler's `node worker.mjs`), never on import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`task-janitor failed: ${e.message}`); process.exit(1); });
}
