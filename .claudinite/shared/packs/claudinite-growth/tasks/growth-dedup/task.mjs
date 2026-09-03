// claudinite-growth task: growth-dedup — the growth lifecycle's PRUNING stage
// (per-project-scheduling DESIGN §6). Prunes local-pack items the canon now
// covers, keeping items the canon states too generally; lands the prunes through
// one PR against the default branch, delivered per the repo's delivery settings.
// Worker: task.md.
//
// The old fleet's `relevantCanonChanged` becomes the `sharedMount` signal — a
// declared pack's vendored files moving is the local echo of "the canon this repo
// mounts changed" — so movement, never the calendar, is what wakes this: a quiet
// repo with no local packs skips.
//
// The cadence is WEEKLY, not daily (#582). A member's mount moves most nights —
// baselining converges it daily — so a daily anchor started this opus session, and
// the PR behind it, nearly every night. Pruning is not latency-sensitive: a
// local item the canon has already absorbed stays harmlessly correct until it goes,
// so the daily anchor bought noise rather than freshness. Nothing is missed by the
// move — both signals below are WINDOW-scoped, and an item's collection window is
// its own task's period, so the weekly run sees a full 7 days of canon and
// local-pack movement batched into one run.
//
// Self-contained (imports nothing): the whole contract is this default export.

export default {
  id: 'growth-dedup',
  frequency: 'weekly',             // the weekly anchor — prunes against the mounted canon that morning's 02:00 baselining converged (DESIGN §2)
  // Either side of the comparison moving is worth a re-check: the mounted canon
  // gained content that may now cover a local item, or the local packs gained
  // items to check against it.
  preconditions: ['mount-moved || commits-under:.claudinite/local'],
  agent_model: 'opus',                   // proving the canon genuinely covers a local item — and telling coverage from "stated too generally" — is a judgment call
  expected_outcome: 'pr',
  // A prune may remove lines or cut one down, never grow one — and only inside
  // the local packs it prunes; the same edit to the repo's own prose is somebody
  // else's document. A `review` member still reviews.
  automerge: ['under:.claudinite/local/packs && markdown-trims'],
  agent_instructions: 'task.md',
  agent_execution_timeout: 1800,            // proving canon coverage per local item — generous bound, extreme protection

  // The deterministic half: what the mounted canon ADDED in the window — prose
  // lines and new checks alike — posted as a comment on the run's own work item,
  // the brief the agentic phase starts from. Reading a diff is code work, and the
  // pack owns it: the `sharedMount` signal names the packs that moved and stops
  // there, deliberately, because a signal is a cheap gate any task may declare,
  // not one task's research. The hand-off is unconditional (worker.mjs) —
  // the precondition below is the only place this run may be declined.
  code_work: 'node worker.mjs',
  code_work_timeout: 600,                     // one commit listing plus a read per window commit
};
