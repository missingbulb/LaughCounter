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
  precondition_signals: ['localPacks', 'sharedMount', 'commits'],
  agent_model: 'opus',                   // proving the canon genuinely covers a local item — and telling coverage from "stated too generally" — is a judgment call
  expected_outcome: 'merged-pr',            // one PR per run, delivered to land per the repo's delivery settings (a `review` member degrades it to open-pr)
  agent_instructions: 'task.md',
  agent_execution_timeout: 1800,            // proving canon coverage per local item — generous bound, extreme protection

  // The deterministic half: what the mounted canon ADDED in the window — prose
  // lines and new checks alike — written into the task's tracker issue as the
  // brief the agentic phase starts from. Reading a diff is code work, and the
  // pack owns it: the `sharedMount` signal names the packs that moved and stops
  // there, deliberately, because a signal is a cheap gate any task may declare,
  // not one task's research. The hand-off is unconditional (worker.mjs) —
  // the precondition below is the only place this run may be declined.
  code_work: 'node worker.mjs',
  code_work_timeout: 600,                     // one commit listing plus a read per window commit

  // Gate: the repo must actually track local packs (no local packs → nothing to
  // prune, self-skip). Given local packs, run when the mounted canon this repo
  // CARES about moved — a declared pack's vendored files changed (`sharedMount`),
  // which can newly cover a local item — or the repo's own local packs changed in
  // the window (a fresh local item to re-check against the canon). A quiet repo
  // with local packs but no relevant movement skips.
  precondition(signals) {
    const local = signals.localPacks ?? {};
    // `present` is null when the scheduler couldn't determine it; treat only an
    // explicit false as "definitely no local packs to prune".
    if (local.present === false) {
      return { run: false, reason: 'no local packs — nothing to prune' };
    }
    const changedPacks = signals.sharedMount?.changedPacks ?? [];
    const canonMoved = changedPacks.length > 0;
    const localChanged = local.changedInWindow === true;

    if (canonMoved) {
      return { run: true, reason: `declared pack(s) changed in the mounted canon: ${changedPacks.join(', ')} — local items may now be covered`, context: [`Re-check local items against these newly-changed canon packs: ${changedPacks.join(', ')}.`] };
    }
    if (localChanged) {
      return { run: true, reason: 'local packs changed in the window — re-check the fresh items against the mounted canon' };
    }
    return { run: false, reason: 'local packs present but no relevant canon or local movement in the window' };
  },
};
