// What the retention prune deletes from the `conversation-logs` branch, as a pure
// function of the branch's file listing — no git, no clock of its own. worker.mjs
// is the I/O shell around this.
//
// AGE IS THE WHOLE TEST, and the capture's own filename carries it: the branch is
// flat, so one tree read answers the question with no commit-history walk and no
// per-file API call. Anything else on the branch (its README) is not a capture and
// is never touched.
//
// What keeps this safe to do without an agent is the extract run's reading window,
// not a per-file handshake: growth-extract reads from the OLDEST end of the branch
// on every run, so a capture reaches retention having been read. That is a property
// of the two cadences — daily reads against a retention measured in days — and it
// is stated in the extract-from-conversations skill, which owns the window.

import { parseLogFilename } from '../../capture-log.mjs';

// The parse comes from the pack's own capture step — its sibling two directories
// up, always vendored with this task — rather than a third copy of the filename
// format guarded against drift.

export const ageDays = (capturedAt, now) => (Date.parse(now) - Date.parse(capturedAt)) / 86400000;

// The retention every member gets without saying anything. The pack recommended
// this floor in prose from the start and applied it nowhere, so `retention_days`
// went unset almost fleet-wide and the branch grew without bound in twelve of
// fourteen members while the task reported success nightly (#1620).
export const DEFAULT_RETENTION_DAYS = 10;

// The declared `retention_days` turned into the number the prune runs on, or `null`
// for "prune nothing". Three inputs, three answers, and the third is why this is a
// function rather than a `??`:
//
//   absent            the member said nothing -> DEFAULT_RETENTION_DAYS
//   a finite number   the member's own call: positive is the window, <= 0 is the
//                     explicit capture-only opt-out that "unset" used to express
//   anything else     UNKNOWN -> null, never the default. The prune's one failure
//                     direction is deleting what it should not, so a value we
//                     cannot read as a number must not become a licence to delete.
export function resolveRetentionDays(declared) {
  if (declared === undefined || declared === null) return DEFAULT_RETENTION_DAYS;
  if (typeof declared !== 'number' || !Number.isFinite(declared)) return null;
  return declared > 0 ? declared : null;
}

// Plan one prune over `names` (the branch's flat file listing) at `now`, against an
// ALREADY-RESOLVED retention — `resolveRetentionDays` above is what turns a
// declaration into one, and both callers go through it.
//
// A retention that is not a positive number means the prune is off for this repo:
// nothing is deletable, and `off` says so rather than reporting an empty prune as a
// completed one.
export function planPrune({ names, retentionDays, now }) {
  const logs = names
    .map((name) => ({ name, parsed: parseLogFilename(name) }))
    .filter((f) => f.parsed !== null);
  const off = !(typeof retentionDays === 'number' && retentionDays > 0);
  return {
    delete: off ? [] : logs.filter((f) => ageDays(f.parsed.capturedAt, now) > retentionDays).map((f) => f.name),
    logCount: logs.length,
    off,
  };
}
