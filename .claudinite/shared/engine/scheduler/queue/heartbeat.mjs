// THE HOLDER'S SIGN OF LIFE (tasks-dispatch DESIGN §6.5, §11, decision §15.15).
// A work step is the work: it may legitimately run for hours, and while it does
// the item goes dark and the executing leash cannot tell it from a dead runner.
// So the executor comments on its own item at a fixed interval, and the scheduler run's
// reclaim measures silence from THAT rather than from a run-length cap.
//
// One mechanism, two things it buys: long work becomes legal (the run cap that
// held the leash arithmetic together retires), and the item's timeline stays live
// through work nobody can otherwise see.
//
// WHAT COUNTS AS ACTIVITY IS THE HOLDER'S OWN SIGNAL, never the issue's
// `updated_at` (#924). Any comment moves `updated_at` — including one written by
// an executor that LOST the claim race and let go — so a clock read off the issue
// defers the reclaim of an item nobody is working on. The struck claims a lost
// race leaves behind carry the episode marker, and are excluded here for exactly
// that reason.

import { CLAIM_MARKER, EPISODE_MARKER } from './work-item.mjs';

export const HEARTBEAT_MARKER = '<!-- claudinite-heartbeat -->';

// Comfortably inside the executing leash (60m), so a live holder is never
// reclaimed on a single missed beat: it takes four in a row.
export const HEARTBEAT_MS = 15 * 60e3;

export const heartbeatComment = ({ executor, at, minutes }) =>
  `${HEARTBEAT_MARKER}\nStill working: executor \`${executor}\`, ${minutes} minute(s) in, at ${at}.`;

// When the current holder last said anything — the newest live claim or heartbeat.
// A struck comment is not a signal: it says its author let the item go.
export function lastLivenessAt(comments = []) {
  const live = comments.filter((c) => {
    const body = c.body ?? '';
    if (body.includes(EPISODE_MARKER)) return false;
    return body.includes(CLAIM_MARKER) || body.includes(HEARTBEAT_MARKER);
  });
  const times = live.map((c) => new Date(c.created_at ?? 0).getTime()).filter((t) => t > 0);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

// Run `work` while beating. The beat is FAIL-SOFT — a comment that does not post
// must never sink a run that is otherwise fine — but never silent: a run whose
// heartbeat failed is one the leash may reclaim underneath it, and the log line is
// the only way to tell that from a run that simply finished quickly.
export async function withHeartbeat(work, { beat, intervalMs = HEARTBEAT_MS, log = () => {} }) {
  if (!beat || !(intervalMs > 0)) return work();
  const startedAt = Date.now();
  let beats = 0;
  const timer = setInterval(() => {
    const minutes = Math.round((Date.now() - startedAt) / 60e3);
    Promise.resolve()
      .then(() => beat(minutes))
      .then(() => { beats += 1; })
      .catch((e) => log(`! heartbeat ${beats + 1} did not post (${e?.message ?? e}) — the leash may reclaim this item mid-work`));
  }, intervalMs);
  // `unref` so a beat pending at exit cannot hold the process open past its work.
  timer.unref?.();
  try {
    return await work();
  } finally {
    clearInterval(timer);
    const minutes = Math.round((Date.now() - startedAt) / 60e3);
    if (beats) log(`- work step ran ${minutes} minute(s) and beat ${beats} time(s)`);
  }
}
