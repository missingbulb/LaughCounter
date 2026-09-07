// The janitor's queue rules (tasks-dispatch DESIGN §11) — the recovery that needs
// judgment or a longer horizon than the scheduler run's hourly label mechanics. Each rule is
// pure, returning the items it claims plus the comment it would post; the
// janitor task's worker is the only I/O shell over them.
//
// THE JANITOR IS A FALLBACK (owner, 2026-09-06). Every rule below repairs something
// that already went wrong — a label swap that tore, a session that died, a park
// nobody answered, a terminal nobody closed — and the healthy flow of a task never
// passes through here: an item the machinery handled correctly is settled by
// whoever handled it, before any of this runs. So a new rule here is a claim that a
// failure mode exists and that nothing nearer to it can close it out; the
// alternative to writing one is usually fixing the flow that left the mess.
//
// AND IT ONLY EVER READS OPEN ITEMS. An item somebody closed is finished, park
// label and all: a person ending a park by closing its issue is an answer, not a
// state to repair, and nothing here reopens, re-labels or re-nags one.
//
// What is NOT here: the executing-leash reclaim, which rides the scheduler run (a
// deterministic label rule, serialized and hourly, recovering a dead executor's
// item in ~2h instead of ~25h). That amends the single-recovery-site split in
// siting, not in principle — recovery still happens once, in one place per rule,
// in code, and never as a sweep inside a session that is executing something.

import { taskPeriodMs } from './anchors.mjs';
import { isScheduledTask } from '../task-contract.mjs';
import {
  READY, AGENT, requeueHint,
  STATUS_READY, STATUS_RUNNING_AGENT, STATUS_BLOCKED, STATUS_DONE, STATUS_REJECTED, isStatus, statusOf,
  isParked, parkKindOf, originOf, ASKED_FOR_ORIGINS, STATUS_NEEDS_HUMAN_FAILURE, isStandingItem,
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
// How long a terminal status may stand on an open issue before rule H reads it as
// torn rather than in flight. A converge writes the label and the close within
// seconds of each other, so an hour is far past any live transition.
export const TERMINAL_OPEN_MS = 3600e3;
export const STUCK_BLOCKED_MS = 2 * 86400e3;

const ms = (t) => (t == null ? null : new Date(t).getTime());
const idle = (item, now) => ms(now) - (ms(item.updated_at) ?? ms(item.created_at) ?? ms(now));

// Rule A — STALE READY. An item no executor picked for ~2 of its own periods comes
// out of the queue as a human's problem. The period is read from the task's
// declared cadence term at HEAD (no title parsing — that was the slot grammar); an
// item whose task is unknown, or keeps no cadence, falls back to a day.
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

// Rule B — THE AGENT LEASH. An item whose agent has not MOVED in ~3h means the
// session died or wedged. The hand-off comment names which session, so the
// escalation can say so.
//
// A beating session is judged on its progress, not its punctuality. `progressAt`
// answers when the beat's note last changed, so a run that keeps beating the same
// note is reclaimed on the same leash as one that went silent — otherwise the beat
// would buy immortality, and the signal would degrade from "work is happening" to
// "a process is alive". An item with no beats answers null and is judged the old
// way, off the issue clock: that is every item filed before the beat existed, and
// the assumption there is stated rather than discovered — a legitimately
// longer-running agent must touch its item, or it is declared dead.
export function deadAgentItems(open = [], now, { leashMs = AGENT_LEASH_MS, progressAt = () => null } = {}) {
  return open.filter((i) => {
    if (!isStatus(i, STATUS_RUNNING_AGENT)) return false;
    const moved = progressAt(i);
    const since = moved ? ms(now) - ms(moved) : idle(i, now);
    return since >= leashMs;
  });
}

export const deadAgentComment = (item, sessionNote = null, { wedged = false } = {}) =>
  `This work item has carried \`${AGENT}\` for over ${Math.round(AGENT_LEASH_MS / 3600e3)}h `
  + `${wedged ? 'without the work moving — the session kept beating, but every beat said the same thing' : 'with no activity'} — `
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
// NEVER AN ITEM SOMEBODY ASKED FOR (#1498). The whole rule rests on one item being
// a FUNGIBLE OCCURRENCE of a repeating task: a later clean run did the same work,
// so this park's question is answered. Both origins a person's action produces are
// the opposite of fungible, for their own reasons. An AD-HOC item is somebody's own
// issue, adopted as itself, and every one of them runs the SAME task
// (`implement-request`), so any later ad-hoc run at all reads as evidence about
// every parked one. That is not a near miss: two verification issues were closed
// citing a third issue's run, their own `Verify:` assertion never executed and the
// owed verification silently discarded (#1161, #1253, on #1154's evidence). A
// MANUAL item names a task the queue does know, but somebody pulled its lever to
// ask something the schedule was not asking — usually a qualifier scoping the run —
// so the task's next clean occurrence did different work. What answers either park
// is its own work being done, which is rule G's `Ends-when` or a person.
//
// `doneAfter(taskId, since)` answers "the newest item for this task that converged
// done strictly after `since`", or null. The worker supplies it from the closed
// half of the queue; the rule stays pure and knows nothing about how it is read.
export function supersededItems(open = [], { doneAfter = () => null } = {}) {
  return open.filter((item) => {
    if (!isParked(item)) return false;
    if (ASKED_FOR_ORIGINS.includes(originOf(item))) return false;
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
//   closed   → the task was REJECTED, so the item is `rejected`
//
// The distinction is the whole point of reading merged-ness rather than state: a
// park closed as `rejected` when its pull request in fact merged would report a
// delivered run as one that never happened.
//
// EITHER OUTCOME ENDS THE ITEM, and the shell closes the issue on both. A person
// who closed the pull request unmerged has already said what happens to this run;
// an item left open under that verdict is the queue asking them to say it twice.
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

// The period of a task, for rule A — read from the cadence term its declaration
// at HEAD states; null (a day, in rule A) for a task that keeps none.
export const periodForTasks = (tasks = []) => {
  const byId = new Map(tasks.map((t) => [`${t.pack}/${t.id}`, t]));
  return (id) => taskPeriodMs(byId.get(id)?.decl);
};

// Rule H — THE UNCLOSED TERMINAL (#1526). A terminal status says the item is over:
// `done` means nothing is left for anyone to act on, `rejected` that nothing will
// happen. Every writer closes the issue in the same breath — so an open one wearing
// one is a transition that TORE, or a session that improvised its converge by hand
// and stopped at the label (#1220, #1265). Either way the item then reads as
// finished to every rule here and to the leash, while sitting open in the queue's
// count forever: the one state nothing else recovers.
//
// The close is the whole of the repair, and the outcome is the status's own — a
// `done` item closes `completed`, a `rejected` one `not_planned`. Nothing is
// relabelled: the status was already right, it was the close that never happened.
//
// TWO GUARDS, because this rule's premise is a torn write and a write in flight
// looks identical (#1104). The clock is the first: an item still inside
// `TERMINAL_OPEN_MS` is a converge that may simply not have reached its close call
// yet. The second is the worker's, a fresh read of the item immediately before
// acting — the snapshot this runs on is seconds old, and by now the converge may
// have finished on its own.
export function unclosedTerminalItems(open = [], now, { boundMs = TERMINAL_OPEN_MS } = {}) {
  return open.filter((item) => {
    if (item.state !== 'open') return false;
    const status = statusOf(item);
    if (status !== STATUS_DONE && status !== STATUS_REJECTED) return false;
    return idle(item, now) >= boundMs;
  });
}

export const unclosedTerminalComment = (status) => (status === STATUS_DONE
  ? `This item carries \`${STATUS_DONE}\` — its run finished and nothing is left for anyone to act on — but it was never closed, `
    + 'so it has been sitting in the open queue looking like live work. Closing it, which is all the terminal was missing.'
  : `This item carries \`${STATUS_REJECTED}\` — it was taken out of the queue — but it was never closed, `
    + `so it has been sitting open looking like live work. Closing it; if the work is still wanted, re-queue it (${requeueHint}).`);

// Rule I — THE ABANDONED FAILURE PARK (#1785). A `failure` park is the one kind that
// HOLDS THE TASK'S LANE (`isBlockingPark`, honoured in `planSchedulerRun` job 1), and
// that is what makes it the one kind with no terminating condition of its own. Rule E
// answers a park with a later clean run of the same task — but while this park stands
// no further occurrence is ever filed, so that answer can never arrive. The other
// three kinds all have one: `action` does not hold the lane, so later runs happen and
// rule E fires; `approval` ends when its pull request resolves (rule G); `decision` is
// a choice a person owes. `failure` alone sits forever
// (missingbulb/TLDR#275: parked by the agent leash, untouched for over three weeks).
//
// So the CLOCK is the answer here, and closing the item is the whole of it: the lane
// is released, the scheduler files a fresh occurrence, and a fault that is still there
// re-parks against a run from this week rather than leaving a month-old trace to read.
//
// STANDING ONLY, and structurally (`isStandingItem` against HEAD's declaration): the
// warrant is that this item is a FUNGIBLE OCCURRENCE, which is exactly what a
// qualified item, a `request` task's item and an adopted issue are not — each is
// somebody's own work, and no clock answers those. A task absent from HEAD states no
// trigger and so is not standing either; that item is rule F's.
export const ABANDONED_PARK_MS = 10 * 86400e3;

export function abandonedParkItems(open = [], now, { scheduledFor = () => null, boundMs = ABANDONED_PARK_MS } = {}) {
  return open.filter((item) => {
    if (statusOf(item) !== STATUS_NEEDS_HUMAN_FAILURE) return false;
    const p = parseWorkItemTitle(item.title);
    if (!p) return false;
    if (!isStandingItem(item, scheduledFor(`${p.pack}/${p.task}`))) return false;
    return idle(item, now) >= boundMs;
  });
}

export const abandonedParkComment = () =>
  `Nothing has touched this park in over ${Math.round(ABANDONED_PARK_MS / 86400e3)} days. Leaving it standing does not preserve the `
  + 'report — nobody is going to read it now, and where the task declares `last-run-not-failed` it also keeps the task from '
  + 'running again at all. A later clean run is '
  + `what would otherwise have closed this. Closing it \`${STATUS_REJECTED}\`: the next scheduled occurrence runs, and if the `
  + `fault is still there it parks again against a trace worth reading. If you were part-way through diagnosing it, re-queue it (${requeueHint}).`;

// Whether a task at HEAD is on the schedule, for rule I's standing test — null for a
// task this repo no longer carries, which reads as not standing.
export const scheduledForTasks = (tasks = []) => {
  const byId = new Map(tasks.map((t) => [`${t.pack}/${t.id}`, t]));
  return (id) => (byId.has(id) ? isScheduledTask(byId.get(id).decl) : null);
};
