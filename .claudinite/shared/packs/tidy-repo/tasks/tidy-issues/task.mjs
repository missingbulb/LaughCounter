// tidy-repo task: tidy-issues — the ACTING half of the tidy sweep
// (per-project-scheduling DESIGN §6). Triages the issues the window touched, and
// re-checks every open issue when the default branch moved substantively (a real
// commit can implement an old issue without the issue itself being touched).
// Worker: task.md. PRs are a separate task: one dimension per task, each with its
// own trigger, scope, and tracker — no ordering barrier between them.
//
// Self-contained (imports nothing): the whole contract is this default export.

export default {
  id: 'tidy-issues',
  frequency: 'daily',                       // the 04:00 anchor (DESIGN §2) — the one tidy dimension that ACTS, so latency matters
  precondition_signals: ['issues', 'commits'],
  agent_model: 'sonnet',                    // "implemented in main" is a judgment call against main's current content
  expected_outcome: 'none',                 // writes ISSUES only (the triage actions + its own tracker) — never a PR
  agent_instructions: 'task.md',
  agent_execution_timeout: 900,             // one dimension over a bounded issue list

  // ONE trigger, and one widener. The trigger is a touched issue: if no issue was
  // filed, commented on, labelled, or reopened in the window, this task does not
  // run — the existing pile got the same triage last time it moved, and re-deriving
  // it costs an agent run per day to rewrite the tracker with itself.
  //
  // The task's own triage comments are the one write that lands on the issues this
  // gate watches, so re-announcing a standing verdict would arm tomorrow's run
  // forever (#988). single-issue-triage does not make that write; nothing here
  // filters it out after the fact.
  //
  // A substantive default-branch move WIDENS an already-triggered run to every open
  // issue, because a real commit can implement an issue the issue itself never
  // recorded — but it no longer wakes the task by itself. On any repo whose `main`
  // moves most days that widening was firing daily, which is a full re-triage of
  // every open issue every day: exactly the "went over the existing ones with
  // nothing new" this gate exists to prevent. A housekeeping-only move (a nightly
  // baseline commit, a bot bump) implements nothing, so it does not widen at all.
  precondition(signals) {
    const substantive = signals.commits?.substantiveChange === true;

    // A `task:*` label is the scheduler's own marker, stamped on a queue work item
    // when it is created and carried for its whole life. The issues signal hides
    // those items by TITLE prefix, so one the queue files under any other title
    // reaches this task and gets triaged as project work. The label is the
    // invariant, so it is what this filters on — and it filters BOTH ways: such an
    // issue is neither a touch that triggers a run nor a target inside one.
    const queueItem = (i) => (i.labels ?? []).some((l) => String(l).startsWith('task:'));
    const open = (signals.issues?.open ?? []).filter((i) => !queueItem(i)).map((i) => i.number);
    const inScope = new Set(open);
    const touched = (signals.issues?.touched ?? []).filter((n) => inScope.has(n));

    // Between the signal's title filter and the label filter above, none of
    // Claudinite's own issues — the queue's work items, its schedule board, the
    // standing trackers — can be triaged as project work or count as the touch
    // that triggers a run.
    if (!touched.length) return { run: false, reason: 'no issues touched in the window' };

    const scope = substantive ? open : touched;
    return {
      run: true,
      reason: substantive
        ? `issues touched, and main moved substantively — re-check all ${scope.length} open issue(s) against it`
        : 'issues touched in the window',
      context: [`Issues to triage: ${scope.map((n) => `#${n}`).join(', ')}.`],
    };
  },
};
