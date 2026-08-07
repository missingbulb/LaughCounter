// basics task: task-janitor — the THIRD responsibility of the scheduled-task
// machinery (owner, 2026-08-06). The scheduler CREATES dispatch issues, the
// executor EXECUTES exactly the one issue that triggered it, and this task —
// alone — cleans up after both: it escalates stale dispatches, reclaims dead
// `agent-running` claims, re-arms dispatches whose trigger event was lost, and
// prints a health review of the open dispatch set. Neither the scheduler nor
// the executor does any of that any more; a task execution cares only about
// its own task, and recovery lives here, in code, once a day.
//
// `agent_model: 'none'` + prework: the whole pass is deterministic code the
// scheduler runs as a subprocess — no agent, no dispatch issue, fully automatic.
//
// Self-contained (imports nothing): the whole contract is this default export.

export default {
  id: 'task-janitor',
  frequency: 'daily',
  precondition_signals: [],
  agent_model: 'none',                   // pure code — cleanup needs no judgment
  expected_outcome: 'none',              // labels and comments only, never a PR
  prework: 'node worker.mjs',
  // One repo-wide issue search plus a handful of label/comment writes — seconds.
  prework_timeout: 300,

  // Unconditional, and honestly so: the sweep itself is the cheap way to learn
  // whether anything needs cleaning, and a quiet repo costs one search. The
  // precondition is the ONLY decision point in a task's life — this one simply
  // always decides yes.
  precondition() {
    return { run: true, reason: 'daily dispatch-issue cleanup and health review' };
  },
};
