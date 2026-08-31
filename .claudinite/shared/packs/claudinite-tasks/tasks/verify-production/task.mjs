// The coded production-validation task (#1530). A verification issue that names
// this task (`Task: claudinite-tasks/verify-production`) carries declarative URL
// probes; the worker fetches and judges them as code-work — Action-side, where
// egress exists — so no agent session is ever spent, and no egress wall is ever
// hit. The grammar and the verdict flow are the worker's (see README.md beside
// it); the filing form is the basics pack's verify-in-production skill.
//
// Self-contained (imports nothing): the whole contract is this default export.

export default {
  id: 'verify-production',
  // MANUAL: an item exists only because a verification was filed and marked —
  // there is nothing to put on a calendar.
  frequency: 'manual',
  precondition_signals: [],
  agent_model: 'none',                   // the whole point: pure code, no session
  expected_outcome: 'none',              // comments and a possible reopen, never a PR
  code_work: 'node worker.mjs',
  // A handful of bounded HTTP fetches plus a few issue writes — minutes at most.
  code_work_timeout: 600,

  // Unconditional: adoption already gated who may route an issue here (the
  // `Task:` field is honoured only for an author with push access), and every
  // later fork — unreadable spec, not yet live, pass, fail — is the run's own
  // verdict, not a reason to skip it.
  precondition() {
    return { run: true, reason: 'a filed production verification is its own mandate' };
  },
};
