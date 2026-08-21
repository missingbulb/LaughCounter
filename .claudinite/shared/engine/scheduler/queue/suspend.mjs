// THE OPERATOR HOLD (tasks-dispatch DESIGN §8, decision §15.24). One repository
// Actions variable stops the whole queue: every Claudinite workflow stamps it
// into its env, and every engine entry point checks it as its FIRST act — before
// any read, like the dormancy gate beside it — and exits cleanly having fired
// nothing.
//
// Why a variable rather than a commit: cancelling one run means "move on", an
// intent the failure continuation and the leash already serve. Stopping the
// SYSTEM is a different intent, and the only lever that existed for it was
// dormancy, which needs a commit and a converge to take effect and another to
// undo. A variable takes effect on the next run and clears the same way.
//
// What it freezes: STARTS, not running work. A run already past this gate
// finishes its item — killing live work would leave exactly the half-done state
// the leash exists to recover — so an in-flight run may close an item after the
// hold goes on. Nothing NEW is ever picked.
//
// Resume needs no code: clear the variable and the next scheduler run reclaims, readies and
// drains on its own. The impatient path is dispatching the SCHEDULER workflow, not
// the bare executor — the scheduler run is what re-derives the world.

export const SUSPEND_ALL_VAR = 'CLAUDINITE_TASKS_SUSPEND_ALL';

// Deliberately narrow: a variable somebody set to `false` or `0` to mean "off"
// must not read as on. Anything else — unset, empty, a word — is not a hold.
export const isSuspended = (env = process.env) =>
  ['true', '1', 'yes'].includes(String(env[SUSPEND_ALL_VAR] ?? '').trim().toLowerCase());

// The one line every entry point prints when it parks, so a run that did nothing
// says WHY it did nothing — a silent clean exit is indistinguishable from a run
// that found no work.
export const suspendedNotice = () =>
  `- ${SUSPEND_ALL_VAR} is set: the queue is held. Nothing is picked up, created, readied or reclaimed.\n`
  + '  Clear the variable in repo settings (Settings → Secrets and variables → Actions → Variables) to resume;'
  + ' the next scheduled scheduler run recovers everything on its own.';
