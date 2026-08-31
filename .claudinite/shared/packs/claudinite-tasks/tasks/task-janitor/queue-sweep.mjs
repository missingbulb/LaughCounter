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
  supersededItems, supersededComment, orphanedParkItems, orphanedParkComment, taskPathIndex,
  endedParkItems, endedParkComment, unclosedTerminalItems, unclosedTerminalComment, periodForTasks,
} from '../../../claudinite-tasks/queue/janitor-rules.mjs';
import {
  QUEUE_LABELS, HANDOFF_MARKER, TASK_OBSOLETE, TASK_DONE, IN_REVIEW_LABEL, isWorkItemTitle,
  NEEDS_HUMAN_ACTION, NEEDS_HUMAN_FAILURE,
  STATUS_BLOCKED, STATUS_READY, STATUS_RUNNING_EXECUTOR, STATUS_RUNNING_AGENT,
  isStatus, isParked, statusOf,
  parseWorkItemTitle, parseWorkItemBody, taskIdFromPath,
} from '../../../claudinite-tasks/queue/work-item.mjs';
import { listOpenWorkItems, listDoneWorkItems } from '../../../claudinite-tasks/queue/read.mjs';
import { ensureLabels, addLabel, removeLabel, comment, listComments, readIssue, closeIssue } from '../../../claudinite-tasks/github.mjs';
import { clearStatus } from '../../../claudinite-tasks/queue/apply-status.mjs';

export async function sweepQueue(gh, repo, now, { tasks = [], log = console.log } = {}) {
  const open = await listOpenWorkItems(gh, repo);
  const result = { open: open.length, staleReady: [], deadAgents: [], stuck: [], stateless: [], superseded: [], orphaned: [], ended: [], unclosed: [] };

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
  // Rule E reads the CLOSED half of the queue, so it is the one rule with an input
  // the others do not share. Read once, indexed by task, newest-done-wins.
  const doneAfter = doneRunLookup(await listDoneWorkItems(gh, repo));
  const superseded = supersededItems(open, { doneAfter });
  const orphaned = orphanedParkItems(open, { tasks });
  // Rule G's input. An `Ends-when` target is a pull request or an issue in this
  // repo, read one at a time — there are only ever as many as there are parks
  // carrying the field. MERGED-NESS, not just state: the issues endpoint carries
  // `pull_request.merged_at` for a pull request, and it is what separates "the work
  // landed" from "it was abandoned". An unreadable target answers null, so the park
  // stands rather than ending on a read that failed.
  const resolutions = new Map();
  for (const item of open) {
    const { endsWhen } = parseWorkItemBody(item.body);
    if (endsWhen == null || resolutions.has(endsWhen)) continue;
    const res = await gh(`/repos/${repo}/issues/${endsWhen}`);
    const target = res.status === 200 ? res.json : null;
    resolutions.set(endsWhen, target?.state !== 'closed' ? null
      : (target.pull_request?.merged_at ? 'merged' : 'closed'));
  }
  const resolutionOf = (n) => resolutions.get(n) ?? null;
  const ended = endedParkItems(open, { resolutionOf });
  const unclosed = unclosedTerminalItems(open, now);

  if (stale.length || deadAgents.length || stateless.length) await ensureLabels(gh, repo, QUEUE_LABELS);

  // Both labels, as everywhere: the state the machine reads plus what the human is
  // being asked for.
  const escalate = async (item, body, from, park) => {
    await comment(gh, repo, item.number, body);
    // Every spelling of the status being left goes: the item may have been filed by
    // an engine older than this one, and a swap that named one spelling would leave
    // the other standing (`apply-status`). The park that replaces it is ONE label.
    if (from) await clearStatus({ removeLabel }, gh, repo, item, from);
    await addLabel(gh, repo, item.number, park);
  };

  for (const item of stale) {
    await escalate(item, staleReadyComment(item), STATUS_READY, NEEDS_HUMAN_ACTION);
    log(`escalated stale-ready #${item.number} → ${NEEDS_HUMAN_ACTION}`);
    result.staleReady.push(item.number);
  }
  // FAILURE, not decision: a dead session is something the machine noticed, never a
  // choice a person made. The kind carries two consequences that both want that
  // reading — it is the only park a later clean run can supersede (rule E), and the
  // only one that holds the task's lane, so the generator stops filing a fresh
  // occurrence each anchor behind a run nobody has looked at.
  for (const item of deadAgents) {
    await escalate(item, deadAgentComment(item, await sessionNote(gh, repo, item)), STATUS_RUNNING_AGENT, NEEDS_HUMAN_FAILURE);
    log(`reclaimed a dead agent claim on #${item.number} → ${NEEDS_HUMAN_FAILURE}`);
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
    // FAILURE for rule B's reason: a swap that tore mid-flight is breakage the
    // machine noticed, so a later clean run of the task may clear it.
    await escalate(item, statelessComment(), null, NEEDS_HUMAN_FAILURE);
    log(`repaired stateless #${item.number} → ${NEEDS_HUMAN_FAILURE}`);
    result.stateless.push(item.number);
  }

  // CLOSING, not escalating — the two rules here that REMOVE an item rather than hand
  // it to a person. Both are safe for the same reason: the evidence is not a clock but
  // a fact about the world (this task ran clean since; this task no longer exists).
  const retire = async (item, body) => {
    await comment(gh, repo, item.number, body);
    await clearStatus({ removeLabel }, gh, repo, item, statusOf(item));
    await addLabel(gh, repo, item.number, TASK_OBSOLETE);
    await closeIssue(gh, repo, item.number, 'not_planned');
  };

  for (const item of superseded) {
    const p = parseWorkItemTitle(item.title) ?? taskIdFromPath(parseWorkItemBody(item.body).taskPath);
    const run = doneAfter(`${p.pack}/${p.task}`, item.updated_at ?? item.created_at);
    await retire(item, supersededComment(run));
    log(`superseded #${item.number} by #${run.number} → ${TASK_OBSOLETE}`);
    result.superseded.push(item.number);
  }
  // Superseded wins where both apply: naming the run that answered it says more than
  // naming the absence of a task file.
  const headPath = taskPathIndex(tasks);
  for (const item of orphaned) {
    if (result.superseded.includes(item.number)) continue;
    const p = parseWorkItemTitle(item.title) ?? taskIdFromPath(parseWorkItemBody(item.body).taskPath);
    const id = `${p.pack}/${p.task}`;
    const at = headPath.get(id) ?? null;
    await retire(item, orphanedParkComment(id, at));
    log(`orphaned park #${item.number} (${id} ${at ? `moved to ${at}` : 'is gone'}) → ${TASK_OBSOLETE}`);
    result.orphaned.push(item.number);
  }

  // Rule G closes on a fact about the world too, but with an outcome of its own: a
  // merged target means the work LANDED, which `retire`'s obsolete/not_planned pair
  // would report as a run that never happened.
  for (const item of ended) {
    if (result.superseded.includes(item.number) || result.orphaned.includes(item.number)) continue;
    const { endsWhen } = parseWorkItemBody(item.body);
    const resolution = resolutionOf(endsWhen);
    await comment(gh, repo, item.number, endedParkComment(endsWhen, resolution));
    await clearStatus({ removeLabel }, gh, repo, item, statusOf(item));
    await addLabel(gh, repo, item.number, resolution === 'merged' ? TASK_DONE : TASK_OBSOLETE);
    // THE RESOLUTION DECIDES, NOT THE SHAPE (#1489). A merged target is a `done`
    // terminal, and a done terminal closes the issue it stands on, marked or filed.
    // Unmerged, nothing landed: the rejected terminal stands on a marked issue and
    // leaves it open, because the run's verdict is not the issue's validity.
    if (resolution === 'merged') await closeIssue(gh, repo, item.number, 'completed');
    else if (isWorkItemTitle(item.title ?? '')) await closeIssue(gh, repo, item.number, 'not_planned');
    // A LEGACY SHADOW ITEM told its request issue it was in review; nothing else
    // would ever take that back, and the review is over.
    const { request } = parseWorkItemBody(item.body);
    if (request && request !== item.number) await removeLabel(gh, repo, request, IN_REVIEW_LABEL);
    log(`ended park #${item.number} — #${endsWhen} ${resolution} → ${resolution === 'merged' ? TASK_DONE : TASK_OBSOLETE}`);
    result.ended.push(item.number);
  }

  // Rule H — the close a torn transition never made. It writes no label: the status
  // is already the right one, and the outcome comes from it. Confirmed against a
  // fresh read like the stateless repair, and for the same reason — a converge that
  // reached its close between this sweep's read and its write needs no help.
  for (const item of unclosed) {
    if (result.superseded.includes(item.number) || result.orphaned.includes(item.number) || result.ended.includes(item.number)) continue;
    const fresh = await readIssue(gh, repo, item.number);
    if (!fresh || fresh.state !== 'open' || unclosedTerminalItems([fresh], now).length === 0) {
      log(`- #${item.number} settled between this sweep's read and its write — left alone`);
      continue;
    }
    const status = statusOf(item);
    await comment(gh, repo, item.number, unclosedTerminalComment(status));
    await closeIssue(gh, repo, item.number, status === TASK_DONE ? 'completed' : 'not_planned');
    log(`closed #${item.number} — it carried ${status} and was never closed`);
    result.unclosed.push(item.number);
  }

  // The health review — the queue as its subject, computable entirely from issues.
  const converged = new Set([...result.staleReady, ...result.deadAgents, ...result.stateless, ...result.superseded, ...result.orphaned, ...result.ended, ...result.unclosed]);
  const count = (status) => open.filter((i) => isStatus(i, status) && !converged.has(i.number)).length;
  log(`health: ${result.open} open work item(s) — ${count(STATUS_BLOCKED)} blocked, ${count(STATUS_READY)} ready, `
    + `${count(STATUS_RUNNING_EXECUTOR)} executing, ${count(STATUS_RUNNING_AGENT)} with an agent, `
    + `${open.filter(isParked).length + converged.size} parked; `
    + `this run escalated ${result.staleReady.length} stale, reclaimed ${result.deadAgents.length} dead agent claim(s), `
    + `surfaced ${result.stuck.length} stuck dependency(ies), repaired ${result.stateless.length} stateless item(s), `
    + `closed ${result.superseded.length} superseded, ${result.orphaned.length} orphaned `
    + `and ${result.ended.length} ended park(s), and closed ${result.unclosed.length} terminal(s) nothing had closed`);
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

// "The newest item for this task that converged done strictly after `since`" — rule
// E's only input, built once over the closed half. Strictly after, because an
// equal-or-earlier success says nothing about a failure that came after it.
export function doneRunLookup(done = []) {
  const byTask = new Map();
  for (const d of done) {
    const p = parseWorkItemTitle(d.title) ?? taskIdFromPath(parseWorkItemBody(d.body).taskPath);
    if (!p) continue;
    const id = `${p.pack}/${p.task}`;
    if (!byTask.has(id)) byTask.set(id, []);
    byTask.get(id).push(d);
  }
  return (id, since) => {
    const at = new Date(since).getTime();
    const runs = (byTask.get(id) ?? [])
      .filter((d) => new Date(d.closed_at ?? d.updated_at).getTime() > at)
      .sort((a, b) => new Date(a.closed_at ?? a.updated_at) - new Date(b.closed_at ?? b.updated_at));
    return runs.at(-1) ?? null;
  };
}
