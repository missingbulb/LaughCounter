// WHEN A BLOCKED ITEM MAY RUN (tasks-dispatch DESIGN §9, decision §15.19,
// reversed by decision §15.31 / #1373). One caller asks this question: the
// scheduler run, hourly, over every open item. A close does not — releasing a
// dependent is deciding whether the world has moved on, which is what the
// scheduler run exists to re-derive, and a task execution converging its own
// item has no business relabelling a sibling work item to answer it.
//
// The backstop framing survives the reversal unchanged: nothing but the
// scheduler run's hourly pass ever releases a blocked item, so a chain link
// waits at most one scheduler run for its dependency to be noticed.

import { STATUS_BLOCKED, isStatus, parseWorkItemBody } from './work-item.mjs';

// Is this item's wait over? `stateOf(n)` answers the state of a `Blocked-by`
// target that may not be a work item at all — an unknown number is never treated
// as closed, so an unreadable blocker DELAYS rather than releases (the
// convergence-not-prevention posture). An item in triage is nobody's to release.
export function isReleasable(item, { stateOf = () => null, nowMs = Date.now() } = {}) {
  if (item.state !== 'open' || !isStatus(item, STATUS_BLOCKED)) return false;
  const { notBefore, blockedBy } = parseWorkItemBody(item.body);
  const blockersDone = blockedBy.every((n) => stateOf(n) === 'closed');
  const timeReached = notBefore === null || nowMs >= new Date(notBefore).getTime();
  return blockersDone && timeReached;
}
