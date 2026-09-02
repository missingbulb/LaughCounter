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

export default {
  id: 'usage-fold',
  frequency: 'daily',                    // see "WHY DAILY" in the header
  // `any-commit`, not `substantive-change`: this task measures the MACHINERY, so a
  // task's own output is exactly what the aggregate folds rather than something to
  // be blind to.
  preconditions: ['any-commit || session-captured'],
  agent_model: 'none',                   // pure code — no agent (task-code-work DESIGN §4)
  expected_outcome: 'pr',
  // The regenerated aggregate is the whole delivery — scoped to the tree it
  // lands in, so a GENERATED file elsewhere in the repo is some other task's.
  // Its merge=ours line is seeded at adoption.
  automerge: ['under:.claudinite/local && generated-file-changes'],
  code_work: 'node worker.mjs',
  // One tree read plus one blob read per capture file in the ~10-day window, all
  // local git, then four REST reads and one PR. A busy repo captures a few files a
  // day, so this is seconds; 600s is ~100x that, generous enough that a huge backlog
  // on a first fold still completes while a hung run is killed well inside the hourly
  // cadence.
  code_work_timeout: 600,
};
