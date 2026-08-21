// The queue's leases and bounds, in one place because three surfaces must agree
// on them (tasks-dispatch DESIGN §11): the scheduler run reclaims on the executing leash,
// the janitor sweeps on the agent leash and the stale bounds, and the task
// contract rejects at author time any code-work whose declared timeout reaches the
// executing leash (F17 — a code-work reclaimed while alive livelocks its item).
//
// The vendored workflows carry the fourth agreement, and the heartbeat reframed
// it (§15.15): what must hold is HEARTBEAT INTERVAL < EXECUTING LEASH, so a
// holder that is alive is never reclaimed, rather than a run cap short enough to
// kill a hung runner before its claim is reaped. The cap bought the guarantee
// that a zombie's code-work never ran beside its replacement's; what carries that
// now is code-work's own re-entrancy requirement, since a partitioned runner can
// keep working while its beats fail to post.

// A dead executor claim is reclaimed after this much silence — the holder's own
// silence, measured from its last claim or heartbeat (#924), never the issue's
// `updated_at`. Long work is legal; a holder that stops beating is not alive.
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
