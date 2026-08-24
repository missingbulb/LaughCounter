// The scheduling CALENDAR — the frequency vocabulary and the anchor arithmetic
// (tasks-dispatch DESIGN §5). Pure and stateless: given the repo's `schedule`
// anchor (dailyHour, weeklyDay, monthlyDay), a frequency and a `now`, it answers
// exactly one question — WHEN is that frequency's most recent occurrence at or
// before `now`.
//
// There is no occurrence IDENTITY here, and that is the point: under the
// work-item queue an occurrence is identified by the item's issue number, so the
// calendar owns the instants and nothing else. `queue/anchors.mjs` is the only
// consumer of the arithmetic; the vocabulary below is what the task contract and
// the author-time declaration check read.
//
// All times are UTC (the `schedule` values are UTC by contract). This module
// never reads the clock itself — `now` is always injected — so every answer is
// deterministic and testable.

// The legal frequency tokens — the vocabulary the runtime contract validates
// against and the author-time declaration check rejects anything outside.
//
// `manual` is the one non-cadence: a manual task has no occurrence at all, so the
// scheduler run never instantiates it and it runs only from an item created by hand
// (`queue/create-work-item.mjs`). It exists for operator levers — work that
// answers no recurring question but wants a task's whole apparatus (declaration,
// contract validation, code-work, the work item) when a human pulls it.
export const FREQUENCIES = ['daily', 'weekly', 'monthly', 'manual'];

// The retired spellings, and what each reads as. `hourly` cannot mean anything under a cron that
// fires twice a day (DESIGN §17.1), and the `daily±Nh` offsets staggered dependent tasks by clock
// hour where `after:` (§9) declares the same intent and actually enforces it.
//
// This map is PERMANENT, not a migration window. A task declaration is member-owned data that no
// vendoring pass rewrites, so a member can carry a retired token indefinitely and must keep
// working; `task-declaration-shape` is what stops a NEW declaration naming one.
export const LEGACY_FREQUENCIES = Object.freeze({
  hourly: 'daily',
  'daily-2h': 'daily',
  'daily-1h': 'daily',
  'daily+1h': 'daily',
});

// What a declaration may CARRY, as against what a new one may be WRITTEN with.
export const ACCEPTED_FREQUENCIES = [...FREQUENCIES, ...Object.keys(LEGACY_FREQUENCIES)];

// THE ONE DOOR (DESIGN §17.1). Applied by `normalizeTaskDeclaration`, so every reader downstream
// of a loaded declaration sees a canonical token — and there is more downstream than the
// calendar: `periodMs` feeds the janitor's stale-ready bound (`queue/janitor-rules.mjs`) and the
// precondition's signal window (`queue/signals.mjs`). Normalizing only the anchor would leave a
// task that now runs daily judged stale after two HOURS, which is a spurious needs-human park on
// exactly the members this tolerance exists for.
export const normalizeFrequency = (frequency) => LEGACY_FREQUENCIES[frequency] ?? frequency;

// The documented anchor defaults (per-project-scheduling DESIGN §2) — applied
// when a repo omits `schedule` or any of its keys. This is the single source of
// these values; the checks layer's load-time range validation
// (engine/checks/helpers/repo-context.mjs) only bounds them, it does not
// re-declare them.
export const DEFAULT_SCHEDULE = { dailyHour: 4, weeklyDay: 'Sun', monthlyDay: 1 };

// Sun-indexed to match Date#getUTCDay (0 = Sunday). Also the canonical weekday
// vocabulary the config validator mirrors.
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Last calendar day of a UTC month (day 0 of the next month rolls back).
const daysInMonth = (year, monthIndex) => new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

// Fill any absent key with its documented default; leave present values
// untouched (the checks layer has already range-validated them at load).
export function normalizeSchedule(schedule = {}) {
  const s = schedule || {};
  return {
    dailyHour: Number.isInteger(s.dailyHour) ? s.dailyHour : DEFAULT_SCHEDULE.dailyHour,
    weeklyDay: WEEKDAYS.includes(s.weeklyDay) ? s.weeklyDay : DEFAULT_SCHEDULE.weeklyDay,
    monthlyDay: Number.isInteger(s.monthlyDay) ? s.monthlyDay : DEFAULT_SCHEDULE.monthlyDay,
  };
}

// The most recent occurrence of `frequency` at or before `now`, as a Date —
// `null` for `manual`, which has none. `now` may be a Date or anything the Date
// constructor accepts; `schedule` is normalized here, so callers need not.
export function anchorInstant(frequency, schedule, now) {
  const s = normalizeSchedule(schedule);
  const at = new Date(now);
  const nowMs = at.getTime();
  // Total over the accepted vocabulary, not just the canonical one: the door normalizes every
  // LOADED declaration, and normalizing here too means a direct caller — a test, `slots.mjs`, a
  // frequency read off something other than a discovered task — cannot get a different answer.
  const freq = normalizeFrequency(frequency);

  if (freq === 'manual') return null;

  if (freq === 'daily') {
    // Walk anchor DATES back from today until the instant is ≤ now: today's anchor hour may not
    // have come yet, in which case the most recent occurrence is yesterday's.
    let anchor = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
    for (;;) {
      const time = new Date(anchor.getTime() + s.dailyHour * HOUR_MS);
      if (time.getTime() <= nowMs) return time;
      anchor = new Date(anchor.getTime() - DAY_MS);
    }
  }

  if (freq === 'weekly') {
    const targetDow = WEEKDAYS.indexOf(s.weeklyDay);
    let date = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
    // Up to 8 steps guarantees the previous week's occurrence even when today is
    // the weekly day but earlier than dailyHour.
    for (let i = 0; i < 8; i += 1) {
      if (date.getUTCDay() === targetDow) {
        const time = new Date(date.getTime() + s.dailyHour * HOUR_MS);
        if (time.getTime() <= nowMs) return time;
      }
      date = new Date(date.getTime() - DAY_MS);
    }
    // Unreachable in practice (a matching weekday always exists within 7 days).
    throw new Error(`no weekly occurrence resolved for ${s.weeklyDay}`);
  }

  if (freq === 'monthly') {
    let year = at.getUTCFullYear();
    let month = at.getUTCMonth();
    for (;;) {
      const day = Math.min(s.monthlyDay, daysInMonth(year, month)); // clamp to month length (DESIGN §2)
      const time = new Date(Date.UTC(year, month, day) + s.dailyHour * HOUR_MS);
      if (time.getTime() <= nowMs) return time;
      month -= 1;
      if (month < 0) { month = 11; year -= 1; }
    }
  }

  throw new Error(`unknown frequency "${frequency}"`);
}
