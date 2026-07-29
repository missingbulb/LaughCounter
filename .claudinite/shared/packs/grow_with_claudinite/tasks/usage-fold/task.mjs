// grow_with_claudinite task: usage-fold — the per-repo skill-usage aggregate
// (skill-usage-metrics DESIGN §5). `agent_model: 'none'` with
// `agent_preprocessing: 'node worker.mjs'`: the whole pass is deterministic code the
// scheduler runs as a subprocess — no agent, no dispatch issue, seconds of runtime.
//
// WHY: a skill is MOUNTED per repo, but mounting only puts a name and a one-line
// description into the session prompt — actually LOADING it is model discretion, and
// nothing recorded whether it ever happened. The only evidence is the session
// transcript, which is ephemeral and dies at retention on the logs branch. So the
// promotion ladder's skill-vs-prose call had no empirical feedback: a skill whose
// trigger never fires looked exactly like one that fires daily. This task counts
// loads — and the DENOMINATORS that make a count mean something — out of the logs
// this repo already captures, into a small tracked aggregate.
//
// Self-contained (imports nothing): the whole contract is this default export.

export default {
  id: 'usage-fold',
  frequency: 'daily',                    // day rows are the unit; a day closes once
  precondition_signals: ['conversationLogs'],
  agent_model: 'none',                   // pure code — no agent (agent-preprocessing DESIGN §4)
  expected_outcome: 'merged-pr',         // the regenerated GENERATED aggregate rides an auto-merging PR
  agent_preprocessing: 'node worker.mjs',
  // One tree read plus one blob read per capture file in the ~10-day window, all
  // local git, then one PR. A busy repo captures a few files a day, so this is
  // seconds; 600s is ~100x that, generous enough that a huge backlog on a first fold
  // still completes while a hung run is killed well inside the hourly cadence.
  agent_preprocessing_timeout: 600,

  // Run whenever there is a logs branch to fold. Deliberately NOT gated on fresh
  // captures: the fold's job includes advancing the week watermark past days that
  // have closed, which is true on a quiet repo too — and a run with nothing new
  // recomputes to a byte-identical file and opens no PR, so a wasted run costs
  // seconds and produces no noise.
  precondition(signals) {
    const logs = signals.conversationLogs ?? {};
    if (logs.present !== true) {
      return { run: false, reason: 'no conversation-logs branch — nothing has been captured, so there is nothing to fold' };
    }
    return { run: true, reason: `fold ${logs.logCount ?? 0} captured log(s) into the usage aggregate (day rows recomputed, closed days folded into their week)` };
  },
};
