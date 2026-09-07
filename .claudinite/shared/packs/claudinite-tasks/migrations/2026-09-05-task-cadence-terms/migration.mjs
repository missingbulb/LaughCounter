// A member's own task declarations state their scheduling in the current vocabulary
// (tasks-dispatch DESIGN §5, #1725). Two rewrites over every
// `.claudinite/local/packs/<pack>/tasks/<name>/task.json`: the retired `frequency`
// field folded into `preconditions` — `due:<cadence>` first in the list, a `none`
// beside it dropped, and `manual` (no schedule) folded into no list at all — and
// then the `trigger` its conditions already implied, stated outright. Both as
// anchored text, so the file's own layout survives.
//
// THE WRITE IS THE ENGINE'S. `updateTaskSchedulingFields: true` names the registry's
// named codemod (engine/migrations/registry.mjs, `applyTaskSchedulingFields`), which
// runs the same rewrite the CLI does. A record cannot carry it: which files hold
// which field is the member's own disk.
//
// GATED ON THE MOUNT, BY CONTENT, for BOTH rewrites. Neither is safe until the
// member's vendored `claudinite-tasks` understands what it would be handed: an
// older calendar validates `due:daily` as an unknown condition and skips the task,
// and an older schema — `additionalProperties: false` — calls a stated `trigger` an
// illegal key in the author's editor. The two lanes deliver on their own cadences,
// so `appliesTo` probes the mounted files for both spellings rather than trusting
// the stamp; an unreadable mount reads as "not capable" and the record stays inert.
// The canon runs the same probe against its own tree (two-root form).
//
// IDEMPOTENT by construction: a task.json with no `frequency` line and a stated
// `trigger` is nothing to rewrite. No apply stage: the rewrite is text, and a
// session has nothing to add.
const CALENDAR = 'packs/claudinite-tasks/calendar.mjs';
const SCHEMA = 'packs/claudinite-tasks/task.schema.json';
const twoRoot = async (read, file) => (await read(`.claudinite/shared/${file}`)) ?? (await read(file));
const mountReadsBothFields = async (read) => {
  const calendar = await twoRoot(read, CALENDAR);
  const schema = await twoRoot(read, SCHEMA);
  return Boolean(calendar) && calendar.includes('cadenceTermFor')
    && Boolean(schema) && schema.includes('"trigger"');
};

export default {
  id: 'task-cadence-terms',
  landed: '2026-09-05',
  // The version is cut on main after the merge (#1726), so a record cannot name it
  // exactly: this is the next number the bump would cut for the pack at 60906.8 —
  // above every member's installed version, so the gap holds the record, and never
  // above the number cut, so a converged member does not re-apply it. RE-CHECK IT
  // AGAINST `pack.mjs` ON EVERY REBASE: main cuts versions while a branch waits, and
  // a record that falls at or below the installed version is silently already done.
  version: '60906.9',
  summary: 'a member\'s local-pack task.json declarations fold the retired `frequency` field into `preconditions` as the cadence term it meant, and state the `trigger` their conditions implied (#1725)',

  appliesTo: mountReadsBothFields,
  updateTaskSchedulingFields: true,

  // The telemetry hook cannot list directories, and what this record retires — a
  // `frequency` line, and an unstated `trigger`, under the member's local packs — is
  // only visible by listing. The fleet-visible signal is the `legacy-task-fields`
  // advisory on each; the doors' removal is gated on that advisory's convergence
  // window (#1732 for the field, #1789 for the derivation).
  legacyPresent: async () => false,
};
