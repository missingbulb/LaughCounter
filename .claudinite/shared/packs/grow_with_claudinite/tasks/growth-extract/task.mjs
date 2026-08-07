// grow_with_claudinite task: growth-extract — the growth lifecycle's CAPTURE
// stage (per-project-scheduling DESIGN §6). ONE task over BOTH lesson sources:
// it runs the extract-from-activity skill over the window's commits/PRs/issues
// and the extract-from-conversations skill over the captured conversation logs,
// then runs prose-to-checks over what it just wrote to see whether any of it
// upgrades to a check — and lands the whole run through a single PR delivered
// per the repo's delivery settings (task.md → the shared deliver-pr.md
// procedure). Worker: task.md.
//
// The two halves were separate tasks (growth-extract + conversation-extract)
// firing in the same daily slot, each opening its own PR against the same local
// packs on the same night. They shared the lesson bar, the promotion ladder, the
// dedup surface and the landing mechanics, so splitting them bought nothing and
// cost a second opus dispatch, a second PR, and two runs deduping against a
// corpus the other one was concurrently writing. One task, two source skills.
//
// Self-contained (imports nothing): the whole contract is this default export.

export default {
  id: 'growth-extract',
  frequency: 'daily-1h',           // the 03:00 slot — lessons captured from an already-converged mount (DESIGN §2)
  precondition_signals: ['commits', 'prs', 'issues', 'conversationLogs'],
  agent_model: 'opus',                   // generalizing/curating lessons is the heaviest judgment, and the default delivery lands the PR with no human review
  expected_outcome: 'merged-pr',            // additive edits to the repo's own local packs; delivered to land per the repo's delivery settings
  agent_instructions: 'task.md',
  agent_execution_timeout: 2700,            // two source passes plus the prose-to-checks upgrade — generous bound, extreme protection

  // TWO independent reasons to run, and the Context says which halves are live:
  //
  //   (a) a SUBSTANTIVE default-branch change — a bot bump / [skip ci] /
  //       nightly-baselining commit advancing main is not a lesson to extract, so
  //       `commits.substantiveChange` already applies that classification. This
  //       arms the activity half AND means a fresh capture now sits on the logs
  //       branch, so the conversation half runs too.
  //   (b) a log on the branch is ACTUALLY past retention — aged material to give a
  //       final hindsight pass and prune, regardless of activity, so the prune
  //       still fires on a quiet repo (a log ages out on wall time, not on the
  //       repo changing). (b) tests the AGE, not just "a branch exists and
  //       retention is configured": that pair is true on every capturing repo
  //       every day, which dispatched an opus agent daily to find nothing prunable.
  //
  // The activity half is scoped by the substantive shas + touched PR/issue numbers
  // passed as binding scope — INCLUDING the PRs merged during the window, whose
  // review discussion is usually its richest lesson source. Context is binding
  // scope and task.md forbids widening past it, so a merged PR the precondition
  // does not name is unreadable to the worker. When only (b) fired, Context says
  // so explicitly, so a quiet-but-aged run skips the activity half rather than
  // inventing a window for it.
  precondition(signals) {
    const commits = signals.commits ?? {};
    const substantive = commits.substantiveChange === true;
    const logs = signals.conversationLogs ?? {};
    const retention = logs.retentionDays;
    const oldest = logs.oldestLogAgeDays;
    const configured = logs.present === true && typeof retention === 'number';
    const aged = configured && typeof oldest === 'number' && oldest > retention;

    if (!substantive && !aged) {
      if (configured) return { run: false, reason: `no substantive default-branch change and no log older than retention ${retention}d — nothing to extract or prune` };
      return { run: false, reason: logs.present ? 'no substantive default-branch change and retention unset — nothing to extract or prune' : 'no substantive default-branch change and no logs branch' };
    }

    const context = [];
    const reasons = [];

    if (substantive) {
      const shas = (commits.list ?? []).filter((c) => c.substantive).map((c) => c.sha.slice(0, 7));
      const prs = signals.prs?.touched ?? [];
      const merged = (signals.prs?.merged ?? []).map((p) => p.number);
      const issues = signals.issues?.touched ?? [];
      reasons.push(`${shas.length} substantive commit(s) in the window`);
      context.push(`Activity half IS in scope: the ${shas.length} substantive commit(s) in the window — ${shas.join(', ')}.`);
      if (merged.length) context.push(`PRs merged in the window — read each one's diff and its review discussion: ${merged.map((n) => `#${n}`).join(', ')}.`);
      if (prs.length) context.push(`PRs touched in the window: ${prs.map((n) => `#${n}`).join(', ')}.`);
      if (issues.length) context.push(`Issues touched in the window: ${issues.map((n) => `#${n}`).join(', ')}.`);
      context.push('Conversation half IS in scope: a substantive merge means fresh captures on origin/conversation-logs — run the fresh pass over the recent window.');
    } else {
      context.push('Activity half is NOT in scope: no substantive default-branch change in the window. Skip extract-from-activity entirely — do not invent a window for it.');
    }

    if (aged) {
      reasons.push(`oldest log ${oldest.toFixed(1)}d old vs retention ${retention}d`);
      context.push(`Retention prune IS due: the oldest log is ${oldest.toFixed(1)}d old against retention ${retention}d. Every log past ${retention}d gets its final hindsight pass, then is removed from the logs branch.`);
    } else if (substantive && configured) {
      context.push(`Retention prune is NOT due: no log is older than retention ${retention}d. Delete nothing.`);
    } else if (substantive) {
      context.push('Retention prune is NOT due: retention is unset for this repo. Delete nothing (capture-only adoption).');
    }

    return { run: true, reason: reasons.join('; '), context };
  },
};
