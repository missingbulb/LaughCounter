// The janitor's sweep over the WORK-ITEM QUEUE (tasks-dispatch DESIGN §11) — the
// half of this task that runs where `taskScheduler.dispatch` is `"queue"`.
//
// It shrinks twice over against the slot-mechanism sweep beside it. The re-arm and
// its grace window are GONE: an executor polls on the tick's cron, so a lost label
// event is latency and never the only delivery. And the executing-leash reclaim
// moved to the TICK — a deterministic label rule, serialized and hourly, which
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
  READY, AGENT, EXECUTING, BLOCKED, NEEDS_HUMAN, QUEUE_LABELS, HANDOFF_MARKER,
  parseWorkItemBody, hasLabel,
} from '../../../../engine/scheduler/queue/work-item.mjs';
import { listOpenWorkItems } from '../../../../engine/scheduler/queue/read.mjs';
import { ensureLabels, addLabel, removeLabel, comment, listComments } from '../../../../engine/scheduler/github.mjs';

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

  const escalate = async (item, body, dropLabel) => {
    await comment(gh, repo, item.number, body);
    if (dropLabel) await removeLabel(gh, repo, item.number, dropLabel);
    await addLabel(gh, repo, item.number, NEEDS_HUMAN);
  };

  for (const item of stale) {
    await escalate(item, staleReadyComment(item), READY);
    log(`escalated stale-ready #${item.number} → ${NEEDS_HUMAN}`);
    result.staleReady.push(item.number);
  }
  for (const item of deadAgents) {
    await escalate(item, deadAgentComment(item, await sessionNote(gh, repo, item)), AGENT);
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
  for (const item of stateless) {
    await escalate(item, statelessComment(), null);
    log(`repaired stateless #${item.number} → ${NEEDS_HUMAN}`);
    result.stateless.push(item.number);
  }

  // The health review — the queue as its subject, computable entirely from issues.
  const converged = new Set([...result.staleReady, ...result.deadAgents, ...result.stateless]);
  const count = (label) => open.filter((i) => hasLabel(i, label) && !converged.has(i.number)).length;
  log(`health: ${result.open} open work item(s) — ${count(BLOCKED)} blocked, ${count(READY)} ready, `
    + `${count(EXECUTING)} executing, ${count(AGENT)} with an agent, `
    + `${open.filter((i) => hasLabel(i, NEEDS_HUMAN)).length + converged.size} needs-human; `
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
