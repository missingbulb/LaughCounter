// APPLYING a status transition — the write half of the vocabulary whose read half
// is `work-item.mjs`'s decode (tasks-dispatch DESIGN §4, the migration of #1119).
//
// One rule, and it is why this is not a plain `swapLabel`: the item may wear ANY
// engine version's spelling of the status it is leaving. A member's items outlive
// its converges, so an item filed as `task:ready` is picked up by an engine that
// writes `task:status:waiting-for-executor`, and a swap that named one spelling
// would leave the other standing — an item wearing two live statuses, which is the
// torn state the janitor exists to repair.
//
// Writes stay granular (add and remove named labels, never a set-write): with
// several executors and a scheduler run moving labels at once, a set-write from a
// stale snapshot clobbers a concurrent transition (DESIGN §4).
// The removes are UNCONDITIONAL — every spelling of the status being left, not
// only the ones the caller's snapshot shows. A caller holds the labels it read
// before its own earlier transitions, so filtering on that snapshot would skip
// exactly the label this engine just wrote; removing a label an issue does not
// carry 404s, which is the end state asked for and therefore success.
import { spellingsOf } from './work-item.mjs';

// Move `item` out of `fromStatus` (canonical — every spelling of it goes) and into
// the label `to`, which is whatever spelling this engine writes.
export async function swapStatus(api, gh, repo, item, fromStatus, to) {
  await clearStatus(api, gh, repo, item, fromStatus);
  return api.addLabel(gh, repo, item.number, to);
}

// Leave a status without entering another — the close path, where the terminal
// label is applied separately.
export async function clearStatus(api, gh, repo, item, status) {
  for (const label of spellingsOf(status)) {
    await api.removeLabel(gh, repo, item.number, label);
  }
}
