// The janitor's queue rules (tasks-dispatch DESIGN §11) — the recovery that needs
// judgment or a longer horizon than the scheduler run's hourly label mechanics. Each rule is
// pure, returning the items it claims plus the comment it would post; the
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
  STATUS_READY, STATUS_RUNNING_AGENT, STATUS_BLOCKED, STATUS_DONE, STATUS_REJECTED, isStatus, statusOf,
  isParked, parkKindOf,
  parseWorkItemTitle, parseWorkItemBody, taskIdFromPath,
} from './work-item.mjs';

export const AGENT_LEASH_MS = 3 * 3600e3;
// The park kinds a later clean run ANSWERS. Both name a broken thing — a failure is
// "read the trace", an action is "the token is missing" — so a run that converged
// clean is proof it is not broken any more. `approval` and `decision` are absent on
// purpose: those parks carry content a person still owes an answer to (an approval
// park typically holds an open PR), and a later success does not answer them. What
// DOES answer an approval park is that pull request resolving — rule G.
export const SUPERSEDABLE_PARKS = Object.freeze(['failure', 'action']);
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

// Rule E — THE SUPERSEDED PARK (#1452). A park is a question about a moment: THIS
// run of this task needs a person. Nothing ever revisits it, so when the cause is
// later fixed the question stays open, and a person has to read it to find out it
// is already answered — 22 of them in one member for one unset secret.
//
// A later CLEAN run of the same task is that answer, in the queue's own record. The
// item converges `rejected` naming the run, and the person never reads it.
//
// STRICTLY later, and only against the item's own last touch: an equal-or-earlier
// success says nothing about a failure that came after it. Only parked items — a
// live one is the machinery working — and only the kinds that named something
// broken (`SUPERSEDABLE_PARKS`).
//
// `doneAfter(taskId, since)` answers "the newest item for this task that converged
// done strictly after `since`", or null. The worker supplies it from the closed
// half of the queue; the rule stays pure and knows nothing about how it is read.
export function supersededItems(open = [], { doneAfter = () => null } = {}) {
  return open.filter((item) => {
    if (!isParked(item)) return false;
    if (!SUPERSEDABLE_PARKS.includes(parkKindOf(item))) return false;
    const p = parseWorkItemTitle(item.title) ?? taskIdFromPath(parseWorkItemBody(item.body).taskPath);
    if (!p) return false;
    return doneAfter(`${p.pack}/${p.task}`, item.updated_at ?? item.created_at) != null;
  });
}

export const supersededComment = (run) =>
  `A later run of this task converged clean — #${run.number}, on ${String(run.closed_at).slice(0, 10)} — so whatever this item `
  + 'was parked on is resolved. Closing it `task:status:rejected` rather than leaving a question nobody needs to answer. '
  + `If this park was about something that run did NOT cover, re-queue it (${requeueHint}).`;

// Rule F — THE ORPHANED PARK (#1452, widened #1461). A park this repo CANNOT RUN at
// HEAD is asking a person about work that can never happen. The executor already
// closes such an item obsolete when it picks one (#1446) — but a PARKED item is never
// picked, so that verdict could never reach the set that needs it most:
// ClaudiniteCanary's seven parked `fleet-digest` items, for a task since retired.
//
// TWO WAYS AN ITEM IS UNRUNNABLE, and the second is why this rule is not just an id
// lookup. An item carries its task twice — the id in its title and the worker PATH in
// its body — and only the id is canonicalized across a pack rename
// (`parseWorkItemTitle`). So an item open across one keeps naming the pre-rename
// directory, the executor's path guard refuses it (executor.mjs), and it parks
// `failure` — where the id lookup alone still reads it as a live task and leaves it
// there. Nothing rewrites an item body and HEAD's path moves only on another rename,
// so that mismatch is permanent: no answer a human could give makes the item runnable
// (ClaudiniteCanary#115, which froze `logs-prune` there for eleven days, because a
// `failure` park holds the task's lane).
//
// `tasks` is the declared task set at HEAD. EMPTY MEANS UNKNOWN, never "everything
// retired": discovery returning nothing is a broken read, and acting on it would close
// the whole queue. An item naming NO path is left alone for the same reason — that is
// the malformed shape `statelessItems` and the executor own, not a verdict about HEAD.
export const taskPathIndex = (tasks = []) => new Map(tasks.map((t) => [`${t.pack}/${t.id}`, t.taskPath]));

export function orphanedParkItems(open = [], { tasks = [] } = {}) {
  if (!tasks.length) return [];
  const headPath = taskPathIndex(tasks);
  return open.filter((item) => {
    if (!isParked(item)) return false;
    const { taskPath } = parseWorkItemBody(item.body);
    const p = parseWorkItemTitle(item.title) ?? taskIdFromPath(taskPath);
    if (!p) return false;
    const at = headPath.get(`${p.pack}/${p.task}`);
    if (at === undefined) return true;
    return !!taskPath && at !== taskPath;
  });
}

// Two causes, two sentences, because the reader's next move differs: a retired task is
// nothing to chase, a relocated one already has a live occurrence somewhere.
export const orphanedParkComment = (id, headPath = null) => (headPath
  ? `This item names \`${id}\` at a path it no longer lives at — the pack was renamed since the item was filed, `
    + `and the task is at \`${headPath}\` now. An item's stored path is never rewritten, so this one can never run. `
    + 'Closing it obsolete; the scheduler files a fresh occurrence at the current path.'
  : `\`${id}\` is not a task this repo carries at HEAD — the pack may be undeclared, or the task retired. `
    + 'This item is parked on work that cannot run again, so it closes `task:status:rejected` rather than '
    + 'waiting for an answer that would change nothing.');

// Rule G — THE ENDED PARK (#1468). A park states what a person owes; nothing watched
// for that debt being PAID. An approval park in particular holds an open pull
// request, which is why rule E excludes it — a later clean run does not answer it —
// so once the pull request merged the item sat open until somebody read it.
//
// `Ends-when: #<n> closed` is the item's own answer to "what would end this", and
// the resolution of that target is the verdict:
//
//   merged   → the work this park was holding LANDED, so the item is `done`
//   closed   → it was abandoned, so the item is `rejected`
//
// The distinction is the whole point of reading merged-ness rather than state: a
// park closed as `rejected` when its pull request in fact merged would report a
// delivered run as one that never happened.
//
// `resolutionOf(n)` answers `'merged' | 'closed' | null` — null for open, unknown,
// or unreadable, all of which mean the park stands. Only parked items: a live item
// is the machinery working, and an item still with an agent has not ended anything.
export function endedParkItems(open = [], { resolutionOf = () => null } = {}) {
  return open.filter((item) => {
    if (!isParked(item)) return false;
    const { endsWhen } = parseWorkItemBody(item.body);
    if (endsWhen == null) return false;
    return resolutionOf(endsWhen) != null;
  });
}

export const endedParkComment = (target, resolution) => (resolution === 'merged'
  ? `#${target} merged, which is what this item was parked waiting for. Closing it \`${STATUS_DONE}\` — `
    + 'the work landed and there is nothing left for anyone to do here.'
  : `#${target} was closed without merging, which ends what this item was parked waiting for. `
    + `Closing it \`${STATUS_REJECTED}\` — nothing landed, so if the work is still wanted, re-queue it (${requeueHint}).`);

// The period of a task, for rule A — read from the declaration at HEAD.
export const periodForTasks = (tasks = []) => {
  const byId = new Map(tasks.map((t) => [`${t.pack}/${t.id}`, t]));
  return (id) => periodMs(byId.get(id)?.decl?.frequency);
};
