// basics task: ci-performance — the weekly read on where this repo's CI time goes,
// and whether it has got worse.
//
// A suite's runtime degrades the way a lawn grows: never in one visible step, so
// nobody profiles it until it is bad enough to complain about, by which point the
// cause is a dozen changes back. This task takes the measurement on a cadence
// instead, from the one ledger that cannot be argued with — the Actions run
// history — and keeps a standing record of it.
//
// CONDITIONAL HANDOFF. Code-work does the measuring, which is pure code: read the
// runs, take each workflow's median over this window and the one before, compare.
// A quiet week ends there — the record is refreshed and no agent is spent. Only a
// real regression requests the agent, which then has something worth its time: a
// named workflow, a before and after, and the ci-performance-evaluation skill's
// method for finding the cause.
//
// WHY sonnet: the finding arrives already localized to a workflow and a delta, and
// the skill states the method step by step; what remains is profiling and a bounded
// fix. Ceilinged at `open-pr`, so a change to how this repo builds or tests always
// lands in front of a reviewer.
//
// Self-contained (imports nothing): the whole contract is this default export.

export default {
  id: 'ci-performance',
  frequency: 'weekly',
  // Movement, not standing state: CI runtime only changes when something lands, so
  // a week with no commits and no PR activity has nothing new to measure — the same
  // runs, the same medians, the same verdict as last week.
  precondition_signals: ['commits', 'prs'],
  agent_model: 'sonnet',
  expected_outcome: 'pr',
  automerge: 'anything',             // CI itself is the gate: a fix that turns anything red cannot merge, and a green one is the point (owner, 2026-08-30)
  agent_instructions: 'task.md',
  code_work: 'node worker.mjs',
  // A couple of hundred run records plus one job breakdown, against this repo's own
  // API. Seconds in practice; the bound is for a rate-limited or wedged read.
  code_work_timeout: 300,
  // Profiling a suite means running it, more than once, in both arms of an A/B.
  agent_execution_timeout: 3600,

  precondition(signals) {
    const commits = signals.commits?.count ?? 0;
    const prs = (signals.prs?.touched ?? []).length;
    if (commits === 0 && prs === 0) {
      return { run: false, reason: 'no commits and no PR activity this week — CI ran on nothing new, so its timings cannot have moved' };
    }
    return { run: true, reason: `${commits} commit(s) and ${prs} touched PR(s) this week — re-measure CI timings and compare against the previous window` };
  },
};
