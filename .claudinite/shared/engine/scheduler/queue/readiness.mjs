// WHEN A BLOCKED ITEM MAY RUN, and who releases it (tasks-dispatch DESIGN §9,
// decision §15.19). Two callers ask the same question at different moments: the
// scheduler run, hourly, over every open item; and whoever CLOSES an item, immediately,
// over the dependents that item was holding. The predicate lives here so those
// two can never answer it differently — the failure that shape produces is a
// chain link that waits an hour on one path and runs at once on the other, with
// nothing red to say which is right.
//
// The scheduler run stays the backstop, deliberately: a close performed by a HUMAN (or by
// a session that stopped early) runs none of this, and the hourly pass is what
// makes that harmless rather than a chain that never resumes.

import { BLOCKED, NEEDS_HUMAN, READY, hasLabel, parseWorkItemBody } from './work-item.mjs';

// Is this item's wait over? `stateOf(n)` answers the state of a `Blocked-by`
// target that may not be a work item at all — an unknown number is never treated
// as closed, so an unreadable blocker DELAYS rather than releases (the
// convergence-not-prevention posture). An item in triage is nobody's to release.
export function isReleasable(item, { stateOf = () => null, nowMs = Date.now() } = {}) {
  if (item.state !== 'open' || !hasLabel(item, BLOCKED) || hasLabel(item, NEEDS_HUMAN)) return false;
  const { notBefore, blockedBy } = parseWorkItemBody(item.body);
  const blockersDone = blockedBy.every((n) => stateOf(n) === 'closed');
  const timeReached = notBefore === null || nowMs >= new Date(notBefore).getTime();
  return blockersDone && timeReached;
}

// Which open items were waiting on THIS one, and are now free. Scoped to items
// naming `closedIssue` among their blockers: a close is not a general readiness
// sweep, and treating it as one would have every close re-derive the whole scheduler run.
export function releasedBy(closedIssue, open = [], { stateOf = () => null, nowMs = Date.now() } = {}) {
  const dependsOnIt = (i) => parseWorkItemBody(i.body).blockedBy.includes(closedIssue);
  return open.filter((i) => dependsOnIt(i) && isReleasable(i, { stateOf, nowMs }));
}

// The shell: read the queue, release what this close freed, and say so. Returns
// the numbers readied, so the caller can decide whether the chain needs a run —
// this function starts none itself, because the executor's own re-dispatch (§10)
// already re-reads the queue after every settle and covers exactly this.
//
// The blocker states come from the issue endpoint one at a time, and only for the
// candidates' own `Blocked-by` numbers: a dependent typically names one or two,
// and reading them beats fetching the repo's issue list a second time.
export async function readyDependents(api, gh, repo, closedIssue, {
  open = null, now = () => new Date(), log = () => {},
} = {}) {
  // Read the queue HERE rather than take the caller's copy: a run holds its item
  // for as long as the work takes, and what was blocked when it started is not
  // what is blocked when it closes.
  if (!open) ({ listOpenWorkItems: open } = await import('./read.mjs'), open = await open(gh, repo));
  const wanted = new Set();
  for (const i of open) {
    if (parseWorkItemBody(i.body).blockedBy.includes(closedIssue)) {
      for (const n of parseWorkItemBody(i.body).blockedBy) wanted.add(n);
    }
  }
  if (!wanted.size) return [];
  const states = new Map([[closedIssue, 'closed']]);
  for (const n of wanted) {
    if (states.has(n)) continue;
    const issue = await api.readIssue(gh, repo, n);
    states.set(n, issue?.state ?? null);
  }

  const freed = releasedBy(closedIssue, open, {
    stateOf: (n) => states.get(n) ?? null,
    nowMs: now().getTime(),
  });
  for (const item of freed) {
    await api.swapLabel(gh, repo, item.number, BLOCKED, READY);
    await api.comment(gh, repo, item.number,
      `Released: #${closedIssue} has closed, and nothing else holds this item.`);
    log(`- #${item.number}: readied — #${closedIssue} closed and nothing else holds it`);
  }
  return freed.map((i) => i.number);
}
