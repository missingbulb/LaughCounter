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
  // The input is the CANON, which moves when this repo does not — so no repo-side
  // condition may gate it, and a silent repo is exactly when the mount most needs
  // the pass. A repo with no vendored mount to update is a fact adoption settled,
  // not a nightly question: such a repo names `claudinite-lifecycle/update` in its
  // `taskScheduler.disabledTasks`.
  preconditions: ['none'],
  agent_model: 'sonnet',                 // the apply stage only — most runs are agentless
  expected_outcome: 'pr',
  automerge: 'anything',             // the converge replaces the vendored mount wholesale — the one lane whose trust is the repo's delivery setting, not a diff class
  agent_instructions: 'task.md',

  code_work: 'node worker.mjs',
  code_work_timeout: 900,
  agent_execution_timeout: 1800,
};
