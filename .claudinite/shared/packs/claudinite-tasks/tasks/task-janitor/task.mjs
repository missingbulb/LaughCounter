// basics task: task-janitor — the THIRD responsibility of the scheduled-task
// machinery (owner, 2026-08-06). The scheduler run CREATES and readies work items, the
// executor EXECUTES exactly the one item it picked, and this task — alone —
// cleans up after both: items stuck ready past their period, items left wearing
// no state label by a torn transition, and a health review of the open set.
// Neither the scheduler run nor the executor does any of that; a task execution cares only
// about its own item, and recovery lives here, in code, once a day.
//
// It also sweeps what the retired slot mechanism left behind: the last slot runs
// filed `[claudinite-task]` dispatch issues in members, and nothing else closes
// them out. That half retires when the fleet's are gone, not before.
//
// The scheduler run reclaims a dead executor claim itself, hourly — this task is the
// slower backstop for what the scheduler run's deterministic label mechanics cannot see.
//
// `agent_model: 'none'` + code_work: the whole pass is deterministic code the
// executor runs as code-work — no agent phase, fully automatic.
//
// Self-contained (imports nothing): the whole contract is this default export.

export default {
  id: 'task-janitor',
  frequency: 'daily',
  // The queue's own health is what this reads, and the queue is exactly what keeps
  // moving on a repo that is otherwise silent — so no repo-side condition gates it.
  preconditions: ['none'],
  agent_model: 'none',                   // pure code — cleanup needs no judgment
  expected_outcome: 'none',              // labels and comments only, never a PR
  code_work: 'node worker.mjs',
  // One repo-wide issue search plus a handful of label/comment writes — seconds.
  code_work_timeout: 300,
};
