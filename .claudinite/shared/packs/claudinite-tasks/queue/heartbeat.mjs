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

import {
  CLAIM_MARKER, EPISODE_MARKER, PROGRESS_HEADING, parseProgressLines, withSection,
} from './work-item.mjs';

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

// --- the agent phase's beat -----------------------------------------------------

// The executor's beat above stops at the hand-off: its process exits, and an agent
// session then holds the item for as long as its own work takes. Nothing beat there,
// so the agent leash had only the issue's `updated_at` to read — the very clock this
// file exists to stop trusting.
//
// The session cannot beat the way the executor does. It has no process of its own to
// hang a timer on, and a scheduled wake reaches it between tool results rather than
// during one, so a beat that must fire inside a long call cannot be promised. What it
// can promise is a beat at each checkpoint its own work already has. Hence the
// interval below is a CEILING the session is asked to stay under, not a timer.
export const AGENT_BEAT_MS = 45 * 60e3;

// Carries the same marker as the executor's beat, so `lastLivenessAt` counts an agent
// beat as the holder's own signal without knowing which phase wrote it.
export const agentBeatComment = ({ session, at, note }) =>
  `${HEARTBEAT_MARKER}\nStill working${session ? `: ${session}` : ''} — ${note}, at ${at}.`;

// One progress line, appended to the item body's own `### Progress` section.
//
// APPENDED, not replaced: the body is the only surface a run can grow in place,
// because the GitHub toolset a session has offers comment creation and no comment
// edit. So the body carries the account and the beats carry the trail — the same
// split the standing trackers use, arrived at from the opposite direction.
export const withProgress = (body, line) =>
  withSection(body, PROGRESS_HEADING, [...parseProgressLines(body), line]);

// WHEN THE WORK LAST MOVED, as distinct from when the holder last spoke.
//
// A beat resets the leash, so a session that beats punctually while wedged would
// never be reclaimed — the signal degrades from "work is happening" to "a process is
// alive", which is the failure the leash exists to catch. The beat already carries
// what separates them: its note is the progress (`9/15 groups triaged`), so a run of
// beats all saying the same thing is a wedged run, however punctual.
//
// Returns when the note last CHANGED — the oldest beat of the trailing run that all
// carry the newest one's note — or null when the item has no beats at all, which is
// the caller's signal to judge it the old way rather than to call it dead.
export function lastProgressAt(comments = []) {
  const beats = comments
    .filter((c) => (c.body ?? '').includes(HEARTBEAT_MARKER) && !(c.body ?? '').includes(EPISODE_MARKER))
    .map((c) => ({ at: new Date(c.created_at ?? 0).getTime(), note: beatNote(c.body ?? '') }))
    .filter((b) => b.at > 0)
    .sort((a, b) => a.at - b.at);
  if (!beats.length) return null;
  const newest = beats[beats.length - 1].note;
  let i = beats.length - 1;
  while (i > 0 && beats[i - 1].note === newest) i -= 1;
  return new Date(beats[i].at).toISOString();
}

// The part of a beat that says where the work got to. Read off the comment rather
// than kept beside it: the beat a session posts through its own GitHub tools is the
// only copy, so the note has to survive the round trip through the rendered body.
const beatNote = (body) => {
  const line = body.split('\n').find((l) => l.startsWith('Still working')) ?? '';
  return (line.match(/ — (.*), at [^,]*\.$/)?.[1] ?? line).trim();
};
