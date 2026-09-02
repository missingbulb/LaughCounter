// The request implementer (tasks-dispatch DESIGN §16) — the engine's one built-in
// task, and the only one that may read an item's `Model`.
//
// A person marks an ordinary issue `task:origin:ad-hoc`; the scheduler run adopts
// it by writing the machine block onto that issue and applying the first status —
// the issue IS the item (§16.1); this task's precondition decides, at pickup,
// whether the run happens; the session implements the issue and leaves a pull
// request. There is no code-work phase at all: the authorization a worker would
// have performed is the precondition's, and the item's `Request:` field — which
// names the item's own issue — is the whole payload.

export default {
  // The literal, not the constant beside it in `built-in-tasks.mjs`: the
  // declaration-shape check reads this file statically and cannot resolve an
  // import. The two are pinned to each other in request-mode.test.mjs.
  id: 'implement-request',
  // MANUAL: the scheduler run never puts this on a calendar. An item exists only because an
  // issue was marked, which is what makes a request a first-class origin of work
  // rather than a schedule nobody asked for.
  frequency: 'manual',
  // The security check, in preconditions.mjs beside this file. It judges the ONE
  // issue this item names — the `Request:` field — which is why the term reads the
  // item rather than a window of repo activity.
  preconditions: ['request-eligible'],
  // The default when the asker named no family; the item's `Model:` overrides it,
  // and only because this task declares the field below.
  agent_model: 'opus',
  model_from_request: true,
  // The ceiling the executor enforces in code. The task's own policy is the full
  // `anything` because the REAL decider is per-request: the asker's `Automerge:`
  // becomes the item's `Merge:` field (§16.11), a policy expression the worker
  // hands to the policy engine, and the task ceiling must not sit below whatever
  // an asker may legitimately authorize. A ceiling is a maximum, not an
  // instruction: with no such field the worker opens a pull request and parks at
  // the approval lane exactly as every request did before, and with one it still
  // parks whenever the policy engine says the diff is not covered.
  expected_outcome: 'pr',
  automerge: 'anything',
  agent_instructions: 'task.md',
  agent_execution_timeout: 4 * 3600,
  // A run that died mid-flight leaves a branch, a PR, or neither, and only a person
  // can say whether the half-done work stands — so nothing re-queues it mechanically.
  on_interrupt: 'needs-human',
};
