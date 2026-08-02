// basics task: baselining — the per-repo SELF-REFRESH (per-project-scheduling
// DESIGN §6; agent-preprocessing DESIGN §7, E4). Every repo baselines ITSELF from
// its own scheduler: converge its `.claudinite/shared/` mount to the current canon
// head, converge its wiring, apply the migration notes that landed since its
// stamp, and advance the stamp — one commit on the per-cycle maintenance PR.
//
// Two stages now. The DETERMINISTIC converge is `agent_preprocessing` (worker.mjs,
// run as a subprocess Action-side BEFORE any agent) — it fetches PUBLIC canon
// directly (owner §10), so NO canon repo needs to be in the session. Most nights
// are agentless and quiet; the AGENT stage (this file's `agent_model`) runs only
// when the worker requests it — a pending AGENTIC migration note, or a converge
// the deterministic pass left non-green (owner, 2026-07-23). The scheduler files
// `ready-for-agent` iff the worker writes CLAUDINITE_REQUEST_AGENT (run.mjs
// conditional handoff, DESIGN §3); the worker and agent communicate only through
// the repository (the pushed branch, the held stamp, the pending note) — task.md.
//
// Self-contained (imports nothing) so the scheduler, executor, and a human all
// load it standalone — the whole contract lives in this default export.

// How stale the mount must be before baselining takes the run to itself, and how
// stale before it stops taking it (see the `exclusive` block in the precondition).
const OVERDUE_DAYS = 1;   // >24h since the last converge landed — a missed cycle
const WEDGED_DAYS = 3;    // past this the repo needs a human, not a quieter fleet

export default {
  id: 'baselining',
  frequency: 'daily-2h',           // the 02:00 slot — a repo's mount is converged before anything reads it (DESIGN §2)
  precondition_signals: ['stamp', 'sharedMount'],
  agent_model: 'sonnet',                 // the RESIDUAL judgment stage — flagged notes / alignment findings; requested only when needed
  expected_outcome: 'merged-pr',            // lands on the maintenance PR; arms auto-merge where member config allows
  agent_instructions: 'task.md',

  agent_preprocessing: 'node worker.mjs',   // the deterministic converge — the scheduler runs it as a subprocess (DESIGN §3, §7)
  agent_preprocessing_timeout: 900,         // clone + converge + wiring + notes + check_the_world; generous but a hard bound
  agent_execution_timeout: 1800,            // generous: a migration-note night can be substantial; the common night runs no agent at all

  // Fire ~daily so the deterministic worker runs and decides for itself whether an
  // agent is needed. PURE over the collected signals — the worker owns the
  // converge/apply/stamp/escalate work; this only gates that the worker RUNS.
  // `canonHead` is null now (the scheduler Action no longer reads canon — the
  // worker fetches it), so the age fallback is the everyday trigger.
  precondition(signals) {
    const stamp = signals.stamp ?? {};
    const changed = signals.sharedMount?.changedPacks ?? [];

    // No stamp → no vendored mount to refresh (the canon's own repo, or a
    // pre-adoption repo): baselining self-skips. `ref` null means the same.
    if (!stamp.ref && stamp.ageDays === null) {
      return { run: false, reason: 'no vendored mount (no stamp) — nothing to self-refresh' };
    }

    // The agent's binding scope, valid whenever the worker escalates: the
    // deterministic converge already ran, so the agent does only the residual that
    // needs judgment. The worker leaves the specifics in the repo (task.md).
    const context = [
      'Preprocessing has already converged the vendored mount, wiring, and mechanical migration notes and pushed the maintenance PR.',
      'Your job is only the residual that needs judgment: apply any pending FLAGGED-agentic migration note (following its own instructions) and/or resolve any conformance finding the deterministic auto-fix could not — then advance the stamp and push to the open maintenance PR. Do not re-run the mechanical converge.',
    ];

    // TAKE THE RUN TO OURSELVES when the mount has not been converged for more
    // than a day (owner, 2026-08-01). The daily anchors stage the chain an hour apart —
    // 02:00 baselining, then 03:00 extract, then 04:00 promote — precisely so a
    // repo's mount is converged before anything reads it. But a GitHub `schedule:`
    // fire is dropped and delayed freely (github-actions-scheduling), and a run
    // that fires hours late finds every daily slot due at once: baselining then
    // dispatches BESIDE the tasks it exists to repair the ground under, instead of
    // before them. On those runs the ordering has to be asserted rather than
    // implied, so we claim the cycle and the engine defers the rest (run.mjs).
    //
    // Bounded at BOTH ends, and both bounds are load-bearing:
    //   - >OVERDUE_DAYS: a converge that landed within the day did its job, and a
    //     routine nightly pass has no standing to hold up the rest of the chain.
    //   - ≤WEDGED_DAYS: a mount stale for days is not a missed fire — it is a
    //     maintenance PR nobody merged, a broken converge, a wedged stamp. That is
    //     a human's problem (the sheepdog freshness sweep is what reports it), and
    //     another night of holding every other task back does not fix it, it just
    //     stops the repo doing anything at all, silently and indefinitely.
    // Read off the stamp, so it measures when baselining last LANDED a converge —
    // not when the task last fired, which would call a nightly failure a success.
    const age = typeof stamp.ageDays === 'number' ? stamp.ageDays : null;
    const exclusive = age !== null && age > OVERDUE_DAYS && age <= WEDGED_DAYS;

    const staleByAge = stamp.canonHead == null && age !== null && age > OVERDUE_DAYS;
    const behindCanon = stamp.canonHead != null && stamp.canonHead !== stamp.ref;
    const mountMoved = changed.length > 0;

    if (behindCanon) return { run: true, exclusive, reason: `mount at ${String(stamp.ref).slice(0, 7)} is behind canon head ${String(stamp.canonHead).slice(0, 7)}`, context };
    if (staleByAge) return { run: true, exclusive, reason: `stamp is ${age.toFixed(1)}d old — run the self-refresh`, context };
    if (mountMoved) return { run: true, exclusive, reason: `vendored files changed for declared pack(s): ${changed.join(', ')}`, context };
    return { run: false, reason: 'mount is at canon head and no vendored files moved' };
  },
};
