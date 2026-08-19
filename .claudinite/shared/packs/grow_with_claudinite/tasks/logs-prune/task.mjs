// grow_with_claudinite task: logs-prune — retention on the `conversation-logs`
// branch. `agent_model: 'none'` with `prework: 'node worker.mjs'`: the whole pass
// is deterministic code the scheduler runs as a subprocess — no agent, no dispatch
// issue, seconds of runtime. The same shape usage-fold already has over the same
// branch.
//
// WHY IT IS NOT PART OF growth-extract. Deleting a capture past retention is
// arithmetic on dates over an orphan branch — which is why the extract worker had
// to spend prose forbidding an agent to merge that branch or rewrite its history.
// Coupled to the opus run it also kept that run's precondition carrying a second
// arm whose only job was to fire the prune on a quiet repo, so a repo with nothing
// to extract still paid an opus dispatch on the nights one log aged out.
//
// WHAT MAKES AGE ENOUGH. The prune used to be coupled to a judgment step — an aged
// log got a final pass before deletion — so pruning on the calendar risked deleting
// a capture nothing had read. What removes the risk is the extract run's READING
// WINDOW, not a per-file handshake between the two tasks: growth-extract reads from
// the oldest end of the branch on every run, against a retention measured in days,
// so a capture reaches retention having been read. The extract-from-conversations
// skill owns that window; this task owns the arithmetic.
//
// Self-contained (imports nothing): the whole contract is this default export.

export default {
  id: 'logs-prune',
  frequency: 'daily',                    // a log ages out on wall time; the branch is read locally, so a run costs seconds
  precondition_signals: ['conversationLogs'],
  agent_model: 'none',                   // pure code — no agent (task-prework DESIGN §4)
  // It opens no PR: its whole write is remove commits on the non-default logs
  // branch, which is outside the outcome taxonomy (per-project-scheduling DESIGN §1).
  expected_outcome: 'none',
  prework: 'node worker.mjs',
  // One ls-remote, one fetch, one tree read, at most one push — against a branch
  // whose size retention itself bounds. Seconds. The bound is protection against a
  // hung network call, not headroom for work, so it sits just past the slowest
  // plausible fetch rather than at the leash.
  prework_timeout: 60,

  // The AGE arm, inherited from growth-extract's second precondition arm — which
  // existed only to fire the prune on a quiet repo and left with it.
  //
  // It tests the age, not "a branch exists and retention is configured": that pair
  // is true on every capturing repo every day. The worker is cheap enough that a
  // run finding nothing costs seconds, but a precondition that is true forever
  // once true is not a trigger at all.
  precondition(signals) {
    const logs = signals.conversationLogs ?? {};
    const retention = logs.retentionDays;
    const oldest = logs.oldestLogAgeDays;
    if (logs.present !== true) return { run: false, reason: 'no conversation-logs branch — nothing captured yet' };
    if (typeof retention !== 'number') return { run: false, reason: 'retention_days is unset — capture-only adoption, the prune deletes nothing' };
    if (!(typeof oldest === 'number' && oldest > retention)) {
      return { run: false, reason: `no log older than retention ${retention}d — nothing to prune` };
    }
    return { run: true, reason: `oldest log ${oldest.toFixed(1)}d old vs retention ${retention}d` };
  },
};
