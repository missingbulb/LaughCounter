// The janitor's sweep over the WORK-ITEM QUEUE (tasks-dispatch DESIGN §11) — the
// half of this task that runs where `taskScheduler.dispatch` is `"queue"`.
//
// It shrinks twice over against the slot-mechanism sweep beside it. The re-arm and
// its grace window are GONE: an executor polls on the scheduler run's cron, so a lost label
// event is latency and never the only delivery. And the executing-leash reclaim
// moved to the SCHEDULER RUN — a deterministic label rule, serialized and hourly, which
// recovers a dead executor's item in ~2h instead of ~25h.
//
// What is left is everything needing judgment or a longer horizon: the dead agent
// claim, the stale-ready escalation, the stuck-dependency sweep (comment only —
// the item still proceeds by itself the moment its blockers resolve), the
// stateless-item repair, and a health review that can now be computed from issues.
//
// This file is the I/O shell; every verdict is a pure rule in the vendored engine,
// so what counts as stale, dead or stuck is decided in exactly one place.

import {
  staleReadyItems, staleReadyComment, deadAgentItems, deadAgentComment,
  stuckBlockedItems, stuckBlockedComment, statelessItems, statelessComment,
  periodForTasks,
} from '../../../../engine/scheduler/queue/janitor-rules.mjs';
import {
  NEEDS_HUMAN, QUEUE_LABELS, HANDOFF_MARKER,
  NEEDS_HUMAN_ACTION, NEEDS_HUMAN_DECISION,
  STATUS_BLOCKED, STATUS_READY, STATUS_RUNNING_EXECUTOR, STATUS_RUNNING_AGENT,
  isStatus, isParked,
  parseWorkItemBody,
} from '../../../../engine/scheduler/queue/work-item.mjs';
import { listOpenWorkItems } from '../../../../engine/scheduler/queue/read.mjs';
import { ensureLabels, addLabel, removeLabel, comment, listComments, readIssue } from '../../../../engine/scheduler/github.mjs';
import { clearStatus } from '../../../../engine/scheduler/queue/apply-status.mjs';

export async function sweepQueue(gh, repo, now, { tasks = [], log = console.log } = {}) {
  const open = await listOpenWorkItems(gh, repo);
  const result = { open: open.length, staleReady: [], deadAgents: [], stuck: [], stateless: [] };

  // A `Blocked-by` target need not be a work item, so its state is read directly.
  const known = new Map(open.map((i) => [i.number, i.state]));
  for (const i of open) {
    for (const n of parseWorkItemBody(i.body).blockedBy) {
      if (known.has(n)) continue;
      const res = await gh(`/repos/${repo}/issues/${n}`);
      known.set(n, res.status === 200 ? res.json?.state ?? null : null);
    }
  }

  const stale = staleReadyItems(open, now, { periodFor: periodForTasks(tasks) });
  const deadAgents = deadAgentItems(open, now);
  const stuck = stuckBlockedItems(open, now, { stateOf: (n) => known.get(n) ?? null });
  const stateless = statelessItems(open);

  if (stale.length || deadAgents.length || stateless.length) await ensureLabels(gh, repo, QUEUE_LABELS);

  // Both labels, as everywhere: the state the machine reads plus what the human is
  // being asked for.
  const escalate = async (item, body, from, triage) => {
    await comment(gh, repo, item.number, body);
    // Every spelling of the status being left goes: the item may have been filed by
    // an engine older than this one, and a swap that named one spelling would leave
    // the other standing (`apply-status`).
    if (from) await clearStatus({ removeLabel }, gh, repo, item, from);
    await addLabel(gh, repo, item.number, NEEDS_HUMAN);
    await addLabel(gh, repo, item.number, triage);
  };

  for (const item of stale) {
    await escalate(item, staleReadyComment(item), STATUS_READY, NEEDS_HUMAN_ACTION);
    log(`escalated stale-ready #${item.number} → ${NEEDS_HUMAN}`);
    result.staleReady.push(item.number);
  }
  for (const item of deadAgents) {
    await escalate(item, deadAgentComment(item, await sessionNote(gh, repo, item)), STATUS_RUNNING_AGENT, NEEDS_HUMAN_DECISION);
    log(`reclaimed a dead agent claim on #${item.number} → ${NEEDS_HUMAN}`);
    result.deadAgents.push(item.number);
  }
  for (const item of stuck) {
    // COMMENT ONLY, deliberately: labels untouched means the item still proceeds
    // by itself the moment its blockers resolve, and a human who decides it is
    // dead closes it by hand.
    const unresolved = parseWorkItemBody(item.body).blockedBy.filter((n) => known.get(n) !== 'closed');
    await comment(gh, repo, item.number, stuckBlockedComment(item, unresolved));
    log(`surfaced stuck dependency on #${item.number} (blocked by ${unresolved.map((n) => `#${n}`).join(', ')})`);
    result.stuck.push(item.number);
  }
  // CONFIRM BEFORE ACTING, and only here. This rule's premise is that the state it
  // is reading is TORN — but a swap in flight is indistinguishable from one that
  // tore, and `open` is a snapshot taken seconds earlier. An executor that settles
  // an item inside that window gets its finished work parked `needs-human`, which
  // is a false triage signal a person then has to read (#1104: #1101 closed
  // `task:done` at 12:50:13Z and was escalated at 12:50:21Z). The other three rules
  // turn on a clock rather than on a transient, so they need no second read.
  for (const item of stateless) {
    const fresh = await readIssue(gh, repo, item.number);
    if (!fresh || fresh.state !== 'open' || statelessItems([fresh]).length === 0) {
      log(`- #${item.number} settled between this sweep's read and its write — left alone`);
      continue;
    }
    await escalate(item, statelessComment(), null, NEEDS_HUMAN_DECISION);
    log(`repaired stateless #${item.number} → ${NEEDS_HUMAN}`);
    result.stateless.push(item.number);
  }

  // The health review — the queue as its subject, computable entirely from issues.
  const converged = new Set([...result.staleReady, ...result.deadAgents, ...result.stateless]);
  const count = (status) => open.filter((i) => isStatus(i, status) && !converged.has(i.number)).length;
  log(`health: ${result.open} open work item(s) — ${count(STATUS_BLOCKED)} blocked, ${count(STATUS_READY)} ready, `
    + `${count(STATUS_RUNNING_EXECUTOR)} executing, ${count(STATUS_RUNNING_AGENT)} with an agent, `
    + `${open.filter(isParked).length + converged.size} needs-human; `
    + `this run escalated ${result.staleReady.length} stale, reclaimed ${result.deadAgents.length} dead agent claim(s), `
    + `surfaced ${result.stuck.length} stuck dependency(ies), repaired ${result.stateless.length} stateless item(s)`);
  return result;
}

// The hand-off comment names the session, so the escalation can say WHICH one
// died rather than merely that one did. Absent (a torn hand-off), the escalation
// says less rather than asserting something it does not know.
async function sessionNote(gh, repo, item) {
  const handoff = (await listComments(gh, repo, item.number))
    .filter((c) => (c.body ?? '').includes(HANDOFF_MARKER)).at(-1);
  const nonce = handoff?.body?.match(/nonce `([^`]+)`/)?.[1];
  return nonce ? `invocation nonce ${nonce}` : null;
}
