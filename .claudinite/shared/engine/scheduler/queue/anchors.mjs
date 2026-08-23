// Anchors — when a task's occurrence falls (tasks-dispatch DESIGN §5).
//
// The arithmetic lives in `calendar.mjs`; this module exposes exactly the two
// questions the queue asks of it — "which occurrence is current" (the scheduler run's
// instantiation guard) and "when does this item wake next" (the roll's stamped
// `Not-before`) — plus the period a frequency repeats on.
//
// Pure and stateless: `now` is always injected, every value is UTC.

import { anchorInstant, normalizeFrequency } from '../calendar.mjs';

const HOUR_MS = 3600e3;
const DAY_MS = 24 * HOUR_MS;

// One period of a frequency, in ms — the unit the janitor's stale-ready rule
// counts in (DESIGN §11) and the coarse step `nextAnchor` walks.
export function periodMs(frequency) {
  // Normalized like `anchorInstant`. Today this changes no answer — every retired token maps to
  // `daily`, which is also the fallthrough below — so it is insurance, not the thing carrying the
  // behaviour: it is what keeps this correct if `LEGACY_FREQUENCIES` ever gains a mapping that is
  // not `daily`. What DOES carry it is the door plus that fallthrough, and why it matters is
  // sharp: this feeds the janitor's stale-ready bound and the precondition's signal window, so a
  // token resolving to an HOUR here parks a member's task needs-human on every sweep (§17.1).
  const freq = normalizeFrequency(frequency);
  if (freq === 'weekly') return 7 * DAY_MS;
  if (freq === 'monthly') return 31 * DAY_MS;
  if (freq === 'manual') return null;
  return DAY_MS;
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
  if (normalizeFrequency(frequency) === 'manual') return null;
  const from = mostRecentAnchor(frequency, schedule, now).getTime();
  const step = normalizeFrequency(frequency) === 'monthly' ? 28 * DAY_MS : periodMs(frequency);
  for (let t = from + step; ; t += step) {
    const candidate = mostRecentAnchor(frequency, schedule, new Date(t));
    if (candidate.getTime() > from) return candidate;
  }
}
