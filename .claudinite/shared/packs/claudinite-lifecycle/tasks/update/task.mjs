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
  expected_outcome: 'pr',
  automerge: 'anything',             // the converge replaces the vendored mount wholesale — the one lane whose trust is the repo's delivery setting, not a diff class
  agent_instructions: 'task.md',

  code_work: 'node worker.mjs',
  code_work_timeout: 900,
  agent_execution_timeout: 1800,

  // PURE over the collected signals. It gates only that the worker RUNS; the worker
  // owns every decision after that — and that division is why this asks almost nothing.
  //
  // THE ONE QUESTION WORTH ASKING IS UNAVAILABLE HERE. "Is this member behind the
  // canon?" needs the canon's versions, and the scheduler Action deliberately does not
  // read canon (DESIGN §3.3): `stamp.canonHead` is always null and no signal carries
  // them. Two proxies have stood in for it and both answered a different question. A
  // datetime in the declaration recorded the last FULL re-vendor, so a member converging
  // nightly read as months overdue forever (#1252). Local movement in the window —
  // "the mount converged and no declared pack's files changed" — reads as "nothing
  // happened here lately", which is equally true of a member that is current and one
  // that canon moved past an hour after its own converge (#1344). The second proxy left
  // LaughCounter and TLDR four packs behind for a day, declining their own updates,
  // with no way out: a forced wake mints the item and the precondition is re-evaluated
  // at pick, so the force converges to a no-op.
  //
  // So it no longer guesses. The asymmetry settles it: declining wrongly costs
  // permanent, silent staleness nothing in the member can repair, while running
  // wrongly costs one converge that finds nothing and exits. A daily no-op is the
  // cheaper mistake by a wide margin.
  precondition(signals) {
    const stamp = signals.stamp ?? {};
    if (!stamp.present) {
      return { run: false, reason: 'no vendored mount (no installed versions) — nothing to update' };
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
