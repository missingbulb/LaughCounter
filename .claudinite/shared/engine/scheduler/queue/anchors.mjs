// Anchors — when a task's occurrence falls (tasks-dispatch DESIGN §5).
//
// The arithmetic lives in `calendar.mjs`; this module exposes exactly the two
// questions the queue asks of it — "which occurrence is current" (the scheduler run's
// instantiation guard) and "when does this item wake next" (the roll's stamped
// `Not-before`) — plus the period a frequency repeats on.
//
// Pure and stateless: `now` is always injected, every value is UTC.

import { anchorInstant } from '../calendar.mjs';

const HOUR_MS = 3600e3;
const DAY_MS = 24 * HOUR_MS;

// One period of a frequency, in ms — the unit the janitor's stale-ready rule
// counts in (DESIGN §11) and the coarse step `nextAnchor` walks.
export function periodMs(frequency) {
  if (frequency === 'hourly') return HOUR_MS;
  if (frequency === 'weekly') return 7 * DAY_MS;
  if (frequency === 'monthly') return 31 * DAY_MS;
  if (frequency === 'manual') return null;
  return DAY_MS; // the daily family
}

// The most recent occurrence at or before `now`, as a Date. `manual` has none —
// the scheduler run never instantiates it (DESIGN §8), so null is the whole answer.
export const mostRecentAnchor = anchorInstant;

// The earliest occurrence strictly after `now` — what a rolled item is stamped
// with. Derived by walking `mostRecentAnchor` forward rather than by adding a
// period: monthly anchors are not a fixed distance apart, and a `daily-2h` whose
// instant wraps to the previous calendar day is exactly the case a fixed add gets
// wrong. The coarse step is under one period, so the loop advances by at most two
// steps and never overshoots an occurrence.
export function nextAnchor(frequency, schedule, now) {
  if (frequency === 'manual') return null;
  const from = mostRecentAnchor(frequency, schedule, now).getTime();
  const step = frequency === 'monthly' ? 28 * DAY_MS : periodMs(frequency);
  for (let t = from + step; ; t += step) {
    const candidate = mostRecentAnchor(frequency, schedule, new Date(t));
    if (candidate.getTime() > from) return candidate;
  }
}
