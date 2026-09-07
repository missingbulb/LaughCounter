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
// What it freezes: STARTS, and — since the drain became batched (§15.30) — each
// PICK inside a running drain. A run already past this gate finishes the item it
// holds: killing live work would leave exactly the half-done state the leash
// exists to recover. Nothing NEW is ever picked.
//
// Resume needs no code: clear the variable and the next scheduler run reclaims, readies and
// drains on its own. The impatient path is dispatching the SCHEDULER workflow, not
// the bare executor — the scheduler run is what re-derives the world.

export const SUSPEND_ALL_VAR = 'CLAUDINITE_TASKS_SUSPEND_ALL';

// Deliberately narrow: a variable somebody set to `false` or `0` to mean "off"
// must not read as on. Anything else — unset, empty, a word — is not a hold.
export const isSuspended = (env = process.env) =>
  ['true', '1', 'yes'].includes(String(env[SUSPEND_ALL_VAR] ?? '').trim().toLowerCase());

// THE BETWEEN-ITEMS READ (§15.30). `vars.*` reaches a run's env at START only, so
// a batched drain — which may legally run for hours — cannot see a hold set after
// it began by re-reading its own environment. This asks the API instead, at each
// item boundary, for as long as asking can still change the answer.
//
// A read that does not answer is NOT a verdict. It falls back to the value this
// run started with: a hold silently reading as "off" spends the queue the operator
// was stopping, and one silently reading as "on" freezes a queue nobody held.
//
// ONCE PER RUN, NOT ONCE PER ITEM (#1791). Two things are said and asked exactly
// once, because a drain crosses dozens of boundaries and every one of them gets
// the same answer as the first:
//
//  - An ACCESS refusal (401/403) is a fact about this run's token, and a token's
//    reach cannot change mid-run. On the reference deployment it is also the
//    PERMANENT answer: reading a repository variable needs variables access, and
//    the workflow `permissions:` block has no key that grants it — so the Actions
//    GITHUB_TOKEN is refused here at every boundary of every drain, forever. The
//    reader stops asking and says so once; the hold then reaches this drain when it
//    next starts, exactly as it did before the drain batched, which is why nothing
//    is load-bearing on that grant.
//  - Anything else (a 5xx, a blip) says nothing about the token, so the next
//    boundary asks again — but the line is still printed once, not per item.
//
// Returns the reader, not the read: the once-per-run state is the whole point, and
// a function called fresh each time cannot hold it.
const isAccessRefusal = (status) => status === 401 || status === 403;

export function liveSuspendReader(gh, repo, { env = process.env, log = () => {} } = {}) {
  let asking = true;
  let said = false;
  return async function heldNow() {
    if (!asking) return isSuspended(env);
    const { status, json } = await gh(`/repos/${repo}/actions/variables/${SUSPEND_ALL_VAR}`);
    // Parsed by the same predicate as the env copy: two spellings of "is this on"
    // would eventually disagree, and this one decides whether work stops.
    if (status === 200) return isSuspended({ [SUSPEND_ALL_VAR]: json?.value });
    // Not set is not a fault: the variable simply does not exist, which is the
    // normal state of every repo nobody has ever held.
    if (status === 404) return false;
    asking = !isAccessRefusal(status);
    if (!said) {
      said = true;
      log(asking
        ? `! ${SUSPEND_ALL_VAR} did not read live (${status}) — using the value this run started with;`
          + ' a later boundary asks again. Said once for this run.'
        : `- ${SUSPEND_ALL_VAR} is not readable live by this run's token (${status}), so the drain keeps the value it`
          + ' started with and a hold set now stops the next run instead. Reading a repository variable needs variables'
          + ' access, which the workflow `permissions:` block cannot grant. Not asked again for this run.');
    }
    return isSuspended(env);
  };
}

// The one line every entry point prints when it parks, so a run that did nothing
// says WHY it did nothing — a silent clean exit is indistinguishable from a run
// that found no work.
export const suspendedNotice = () =>
  `- ${SUSPEND_ALL_VAR} is set: the queue is held. Nothing is picked up, created, readied or reclaimed.\n`
  + '  Clear the variable in repo settings (Settings → Secrets and variables → Actions → Variables) to resume;'
  + ' the next scheduled scheduler run recovers everything on its own.';
