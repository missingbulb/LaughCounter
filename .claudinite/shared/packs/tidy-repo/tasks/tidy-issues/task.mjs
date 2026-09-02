// tidy-repo task: tidy-issues — the ACTING half of the tidy sweep
// (per-project-scheduling DESIGN §6). Triages the issues the window touched, and
// re-checks every open issue when the default branch moved substantively (a real
// commit can implement an old issue without the issue itself being touched).
// Worker: task.md. PRs are a separate task: one dimension per task, each with its
// own trigger, scope, and tracker — no ordering barrier between them.
//
// Self-contained (imports nothing): the whole contract is this default export.

export default {
  id: 'tidy-issues',
  frequency: 'daily',                       // the 04:00 anchor (DESIGN §2) — the one tidy dimension that ACTS, so latency matters
  // An issue of this repo's own moved. The scheduler's own work items are not such
  // an issue — the term filters them out, so the queue's churn never wakes this.
  preconditions: ['issues-touched'],
  agent_model: 'sonnet',                    // "implemented in main" is a judgment call against main's current content
  expected_outcome: 'none',                 // writes ISSUES only (the triage actions + its own tracker) — never a PR
  agent_instructions: 'task.md',
  agent_execution_timeout: 900,             // one dimension over a bounded issue list
};
