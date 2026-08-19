// The queue's leases and bounds, in one place because three surfaces must agree
// on them (tasks-dispatch DESIGN §11): the tick reclaims on the executing leash,
// the janitor sweeps on the agent leash and the stale bounds, and the task
// contract rejects at author time any code-work whose declared timeout reaches the
// executing leash (F17 — a code-work reclaimed while alive livelocks its item).
//
// The vendored workflows carry the fourth agreement: the executor job's
// `timeout-minutes` must be ≤ the executing leash, so a hung runner is killed by
// the platform before its claim is reaped and re-picked — otherwise a zombie's
// code-work runs beside its replacement's.

// A dead executor claim is reclaimed after this much silence. An executor
// iteration is minutes, not hours.
export const EXECUTING_LEASH_MS = 60 * 60e3;

// An agent session silent this long is declared dead. A legitimately longer run
// must comment on its item to reset the activity clock — stated as an assumption
// rather than discovered as an incident.
export const AGENT_LEASH_MS = 3 * 3600e3;

// An item nothing picked up for this many of its own periods leaves the queue for
// triage; a blocked item whose blockers never resolve is surfaced (comment only)
// after this long.
export const STALE_READY_PERIODS = 2;
export const STUCK_BLOCKED_MS = 2 * 86400e3;
