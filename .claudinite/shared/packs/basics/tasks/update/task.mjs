// basics task: update — the versioned engine/pack update flows, run by a repo on
// itself (#768, docs/versioned-updates/DESIGN.md). The successor to `baselining`,
// and for now its sibling: exactly one of the two serves any repo, decided by that
// repo's own `maintenance.mechanism` (engine/served-by.mjs).
//
// A repo that has not been flipped declares nothing, is served by baselining, and
// never reaches this task's worker — which stands down in that case rather than
// assuming. So adding this task changes nothing for a member until someone writes
// the flag into its declaration.
//
// Two stages, like baselining's. The DETERMINISTIC flows are `prework`
// (worker.mjs): they converge the mount, run the version-ranged migrations, gate on
// the converged tree's self-test, open the PR, and act on the terminal. The AGENT
// stage runs only when the pack flow's apply stage is needed — the pack's new rules
// meeting member-authored content the canon has never seen.
//
// Self-contained (imports nothing) so the scheduler, executor, and a human all load
// it standalone — the whole contract lives in this default export.

const OVERDUE_DAYS = 1;

export default {
  id: 'update',
  frequency: 'daily-2h',                 // the same 02:00 slot baselining holds: a repo's mount is converged before anything reads it
  precondition_signals: ['stamp', 'sharedMount'],
  agent_model: 'sonnet',                 // the apply stage only — most runs are agentless
  expected_outcome: 'merged-pr',
  agent_instructions: 'task.md',

  prework: 'node worker.mjs',
  prework_timeout: 900,
  agent_execution_timeout: 1800,

  // PURE over the collected signals. It gates only that the worker RUNS; the worker
  // owns every decision after that, including whether this repo is its to serve —
  // which is deliberately NOT decided here. The signals carry the stamp, not the
  // declaration, and a precondition that guessed at the mechanism from a stamp would
  // be a second answer to a question `servedBy` already answers from the file.
  precondition(signals) {
    const stamp = signals.stamp ?? {};
    if (!stamp.ref && stamp.ageDays === null) {
      return { run: false, reason: 'no vendored mount (no stamp) — nothing to update' };
    }
    const age = stamp.ageDays;
    if (age !== null && age < OVERDUE_DAYS && !(signals.sharedMount?.changedPacks ?? []).length) {
      return { run: false, reason: `converged ${age}d ago and no pack moved — nothing due` };
    }
    return {
      run: true,
      reason: 'the mount is due an update pass',
      context: [
        'The deterministic flows have already run: the mount is converged, the version-ranged migrations applied, and the update PR is open.',
        'Your job is only the apply stage — bring this repo\'s own content in line with the updated pack rules on that branch, and verify the executor routine. Do not re-run the mechanical converge.',
      ],
    };
  },
};
