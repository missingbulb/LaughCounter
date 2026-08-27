// The janitor's queue rules (tasks-dispatch DESIGN §11) — the recovery that needs
// judgment or a longer horizon than the scheduler run's hourly label mechanics. Four rules,
// pure, each returning the items it claims plus the comment it would post; the
// janitor task's worker is the only I/O shell over them.
//
// What is NOT here: the executing-leash reclaim, which rides the scheduler run (a
// deterministic label rule, serialized and hourly, recovering a dead executor's
// item in ~2h instead of ~25h). That amends the single-recovery-site split in
// siting, not in principle — recovery still happens once, in one place per rule,
// in code, and never as a sweep inside a session that is executing something.

import { periodMs } from './anchors.mjs';
import {
  READY, AGENT, requeueHint,
  STATUS_READY, STATUS_RUNNING_AGENT, STATUS_BLOCKED, isStatus, statusOf,
  parseWorkItemTitle, parseWorkItemBody, taskIdFromPath,
} from './work-item.mjs';

export const AGENT_LEASH_MS = 3 * 3600e3;
export const STALE_READY_PERIODS = 2;
export const STUCK_BLOCKED_MS = 2 * 86400e3;

const ms = (t) => (t == null ? null : new Date(t).getTime());
const idle = (item, now) => ms(now) - (ms(item.updated_at) ?? ms(item.created_at) ?? ms(now));

// Rule A — STALE READY. An item no executor picked for ~2 of its own periods comes
// out of the queue as a human's problem. The period is read from the task's
// declared `frequency` at HEAD (no title parsing — that was the slot grammar); an
// item whose task is unknown falls back to a day.
//
// WHICH TASK, on a marked issue: its title is the person's own, so the id comes
// from the worker path its machine block names — without that fallback a request
// nobody picks up would sit ready forever, the one item class no rule here covers.
export function staleReadyItems(open = [], now, { periodFor = () => null, factor = STALE_READY_PERIODS } = {}) {
  return open.filter((i) => {
    if (!isStatus(i, STATUS_READY)) return false;
    const parsed = parseWorkItemTitle(i.title) ?? taskIdFromPath(parseWorkItemBody(i.body).taskPath);
    if (!parsed) return false;
    const per = periodFor(`${parsed.pack}/${parsed.task}`) ?? 86400e3;
    // `readySince` is the item's last touch: every transition into ready is a
    // label write, so an item that has sat unread since then has not been touched.
    return idle(i, now) >= factor * per;
  });
}

export const staleReadyComment = (item) => {
  const p = parseWorkItemTitle(item.title) ?? taskIdFromPath(parseWorkItemBody(item.body).taskPath);
  return `This work item for ${p ? `${p.pack}/${p.task}` : 'this task'} has sat \`${READY}\` for over ~${STALE_READY_PERIODS} of its scheduling periods `
    + 'without an executor picking it up. Parking it for a human and taking it out of the queue.';
};

// Rule B — THE AGENT LEASH. An item with an agent silent past ~3h means the session died.
// The hand-off comment names which session, so the escalation can say so. The
// assumption is stated rather than discovered: a legitimately longer-running agent
// must comment on its item to reset the activity clock, or it is declared dead.
export function deadAgentItems(open = [], now, { leashMs = AGENT_LEASH_MS } = {}) {
  return open.filter((i) => isStatus(i, STATUS_RUNNING_AGENT) && idle(i, now) >= leashMs);
}

export const deadAgentComment = (item, sessionNote = null) =>
  `This work item has carried \`${AGENT}\` for over ${Math.round(AGENT_LEASH_MS / 3600e3)}h with no activity — `
  + `the agent session that claimed it${sessionNote ? ` (${sessionNote})` : ''} never converged it. Parking it for a human.`;

// Rule C — THE STUCK-DEPENDENCY SWEEP (F14). The stale-ready rule cannot see this
// at all: a blocked item is never ready. So a blocked item whose blockers have not
// resolved past the bound gets an escalation COMMENT and nothing else — labels
// untouched, so the item still proceeds by itself the moment its blockers resolve,
// and a human who decides it is dead closes it by hand.
//
// Sleeping items (a future `Not-before`, blockers closed) never match: waiting for
// a time is the mechanism working.
export function stuckBlockedItems(open = [], now, { stateOf = () => null, boundMs = STUCK_BLOCKED_MS } = {}) {
  return open.filter((i) => {
    if (!isStatus(i, STATUS_BLOCKED)) return false;
    const { blockedBy } = parseWorkItemBody(i.body);
    if (!blockedBy.length) return false;
    if (blockedBy.every((n) => stateOf(n) === 'closed')) return false;
    return ms(now) - ms(i.created_at) >= boundMs;
  });
}

export const stuckBlockedComment = (item, unresolved) =>
  `This work item has been blocked on ${unresolved.map((n) => `#${n}`).join(', ')} for over `
  + `${Math.round(STUCK_BLOCKED_MS / 86400e3)} days. Nothing here is stuck mechanically — it will proceed by itself the moment those close — `
  + 'but if they are never going to, close this item by hand.';

// Rule D — THE STATELESS-ITEM REPAIR. An open work item whose labels decode to no
// status at all is off the state machine entirely: a torn label swap's
// leavings (an executor that died between the remove and the add), invisible to
// every rule that filters by state. It converges to triage — the same posture a
// malformed item gets.
export function statelessItems(open = []) {
  return open.filter((i) => statusOf(i) === null);
}

export const statelessComment = () =>
  'This work item carries no state label at all — the leavings of a label swap that tore mid-flight, which puts it outside the state machine. '
  + `Parking it for a human: re-queue it by hand (${requeueHint}) once you have looked at it.`;

// The period of a task, for rule A — read from the declaration at HEAD.
export const periodForTasks = (tasks = []) => {
  const byId = new Map(tasks.map((t) => [`${t.pack}/${t.id}`, t]));
  return (id) => periodMs(byId.get(id)?.decl?.frequency);
};
