// claudinite-growth task: usage-fold — the per-repo usage aggregate
// (skill-usage-metrics DESIGN §5). `agent_model: 'none'` with
// `code_work: 'node worker.mjs'`: the whole pass is deterministic code the
// executor runs as code-work — no agent phase, seconds of runtime.
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
// It also counts what the MACHINERY did: how often the scheduler and the executor
// ran, how many of those hours a session actually opened, what each closed work item
// came to, and what landed in git. That half exists in a repo whose sessions are all
// unattended and captured nothing at all.
//
// WHY DAILY. The file is the whole past-data plane the dashboard renders from
// (claudinite-dashboard) — every panel that reaches further back than one page of live reads
// comes from here. It folded hourly until the scheduler's cron went to two ticks a day
// (tasks-dispatch DESIGN §17): a frequency finer than the cron cannot be honoured, since the
// anchor is only ever seen when a tick comes. Nothing about the DATA changes — hour rows are
// still recomputed from source across a three-day window, so only the newest rows' freshness
// moves, and the dashboard already tops up the freshest hours from the live run listing it
// fetches anyway. The precondition is what keeps a quiet repo quiet.
//
// Self-contained (imports nothing): the whole contract is this default export.

// The signal window a task is judged over: its own period plus the scheduler's hour of slack. A
// log stamped inside it is a session that ran since the last fold. This MUST track the declared
// frequency — sized to an hour while the task anchors daily, the "a session captured" arm never
// fires (a log is ~23h old by the next anchor) and a repo whose only movement is commit-less
// sessions silently stops folding altogether.
const WINDOW_DAYS = 25 / 24;

export default {
  id: 'usage-fold',
  frequency: 'daily',                    // see "WHY DAILY" in the header
  precondition_signals: ['commits', 'conversationLogs'],
  agent_model: 'none',                   // pure code — no agent (task-code-work DESIGN §4)
  expected_outcome: 'merged-pr',         // the regenerated GENERATED aggregate rides a PR landed per the repo's delivery settings
  code_work: 'node worker.mjs',
  // One tree read plus one blob read per capture file in the ~10-day window, all
  // local git, then four REST reads and one PR. A busy repo captures a few files a
  // day, so this is seconds; 600s is ~100x that, generous enough that a huge backlog
  // on a first fold still completes while a hung run is killed well inside the hourly
  // cadence.
  code_work_timeout: 600,

  // Gated on the repo having MOVED this hour, which is the whole difference between an
  // hourly fold and an hourly PR. Two movements are visible to a collector and both
  // change the numbers: a commit on the default branch (the git series, and whatever
  // landed with it), and a conversation log stamped inside the window (a session ran).
  //
  // Deliberately NOT gated on the scheduler having run: it runs every hour by
  // definition, so that gate would be no gate at all. Its runs are not lost by
  // declining — they sit past the watermark and the next fold that does run reads
  // them, and the dashboard tops up the freshest hours from the live run listing it
  // already fetches.
  precondition(signals) {
    const commits = signals.commits ?? {};
    const logs = signals.conversationLogs ?? {};
    const moved = [];
    if (commits.count > 0) moved.push(`${commits.count} commit(s) on the default branch`);
    // `newestLogAgeDays` is null when the branch does not exist or carries no readable
    // stamp — unknown, which is not movement.
    if (logs.newestLogAgeDays !== null && logs.newestLogAgeDays !== undefined && logs.newestLogAgeDays <= WINDOW_DAYS) {
      moved.push('a session captured');
    }
    if (!moved.length) {
      return {
        run: false,
        reason: 'nothing moved this period — no commit on the default branch and no new conversation log; '
          + 'the run and queue reads stay past their watermarks for the next fold that has something to do',
      };
    }
    return { run: true, reason: `fold ${moved.join(' and ')} into the usage aggregate` };
  },
};
