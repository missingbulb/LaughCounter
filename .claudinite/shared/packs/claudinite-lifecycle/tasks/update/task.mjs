// basics task: update — the versioned engine/pack update flows, run by a repo on
// itself (#768 — see the versioned-updates design there). The successor to
// `baselining`, and since Phase 5 deleted that, the only thing that maintains a
// member's mount: there is no mechanism flag left to consult, and the block that
// held one is gone (#1252).
//
// Two stages, like baselining's. The DETERMINISTIC flows are `code_work`
// (worker.mjs): they converge the mount, run the version-ranged migrations, gate on
// the converged tree's self-test, open the PR, and act on the terminal. The AGENT
// stage runs only when the pack flow's apply stage is needed — the pack's new rules
// meeting member-authored content the canon has never seen.
//
// Self-contained (imports nothing) so the scheduler, executor, and a human all load
// it standalone — the whole contract lives in this default export.

export default {
  id: 'update',
  frequency: 'daily',                    // the head of the morning chain — everything that reads a converged mount declares `schedule_after:` this
  precondition_signals: ['stamp', 'sharedMount'],
  agent_model: 'sonnet',                 // the apply stage only — most runs are agentless
  expected_outcome: 'merged-pr',
  agent_instructions: 'task.md',

  code_work: 'node worker.mjs',
  code_work_timeout: 900,
  agent_execution_timeout: 1800,

  // PURE over the collected signals. It gates only that the worker RUNS; the worker
  // owns every decision after that.
  //
  // Newness comes from the mount's OWN movement in the window, never from a
  // datetime in the declaration: the one that used to be stamped there recorded the
  // last full re-vendor, so a member converging nightly looked months overdue
  // forever (#1252). "The mount converged inside this window" is the same question
  // the age was a proxy for, asked of the commits that would have done it.
  precondition(signals) {
    const stamp = signals.stamp ?? {};
    if (!stamp.present) {
      return { run: false, reason: 'no vendored mount (no installed versions) — nothing to update' };
    }
    if (stamp.convergedInWindow && !(signals.sharedMount?.changedPacks ?? []).length) {
      return { run: false, reason: 'the mount converged in this window and no pack moved — nothing due' };
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
