// claudinite-growth task: growth-extract — the growth lifecycle's CAPTURE
// stage (per-project-scheduling DESIGN §6). ONE task over BOTH lesson sources:
// it runs the extract-from-activity skill over the window's commits/PRs/issues
// and the extract-from-conversations skill over the captured conversation logs,
// then runs prose-to-checks over what it just wrote to see whether any of it
// upgrades to a check — and lands the whole run through a single PR delivered
// per the repo's delivery settings (task.md → the shared deliver-pr.md
// procedure). Worker: task.md.
//
// The two halves were separate tasks (growth-extract + conversation-extract)
// firing at the same daily anchor, each opening its own PR against the same local
// packs on the same night. They shared the lesson bar, the promotion ladder, the
// dedup surface and the landing mechanics, so splitting them bought nothing and
// cost a second opus dispatch, a second PR, and two runs deduping against a
// corpus the other one was concurrently writing. One task, two source skills.
//
// Self-contained (imports nothing): the whole contract is this default export.

export default {
  id: 'growth-extract',
  frequency: 'daily',
  // The ordering, declared (tasks-dispatch DESIGN §9) — and now the ONLY thing carrying it, since
  // the staggered anchor hours retired with the twice-daily cron (§17.1). This task reads a mount
  // `claudinite-lifecycle/update` converges, so it yields while that task's item is live this
  // cycle and runs the moment it converges — or rolls. The offset only ever implied this; the
  // declaration enforces it.
  schedule_after: ['claudinite-lifecycle/update'],
  precondition_signals: ['commits', 'prs', 'issues'],
  agent_model: 'opus',                   // generalizing/curating lessons is the heaviest judgment, and the default delivery lands the PR with no human review
  expected_outcome: 'pr',
  // Lessons land in the repo's own local packs — prose, and the checks the in-run
  // upgrade pass produces (this pack's merge-rules.json declares both classes).
  automerge: ['claudinite-local-pack-md-changes', 'claudinite-local-pack-check-changes'],
  agent_instructions: 'task.md',
  agent_execution_timeout: 2700,            // two source passes plus the prose-to-checks upgrade — generous bound, extreme protection

  // ONE reason to run: a SUBSTANTIVE default-branch change. A bot bump / [skip ci] /
  // nightly-baselining commit advancing main is not a lesson to extract, and neither
  // is a commit that touched nothing outside `.claudinite/` — this lifecycle's own
  // landed output, which would otherwise re-arm it every night and keep a quiet repo
  // firing forever. `commits.substantiveChange` already applies that classification.
  // It arms the activity half AND means a fresh capture now sits on the logs branch,
  // so the conversation half runs too.
  //
  // There WAS a second arm — a log actually past retention, which existed only so
  // the retention prune still fired on a repo gone quiet. The prune is its own
  // agentless task now (../logs-prune/), so that arm left with it and this opus
  // dispatch no longer happens on nights with nothing to extract.
  //
  // The activity half is scoped by the substantive shas + touched PR/issue numbers
  // passed as binding scope — INCLUDING the PRs merged during the window, whose
  // review discussion is usually its richest lesson source. Context is binding
  // scope and task.md forbids widening past it, so a merged PR the precondition
  // does not name is unreadable to the worker.
  precondition(signals) {
    const commits = signals.commits ?? {};
    if (commits.substantiveChange !== true) {
      return { run: false, reason: 'no substantive default-branch change in the window — nothing to extract' };
    }

    const shas = (commits.list ?? []).filter((c) => c.substantive).map((c) => c.sha.slice(0, 7));
    const prs = signals.prs?.touched ?? [];
    const merged = (signals.prs?.merged ?? []).map((p) => p.number);
    const issues = signals.issues?.touched ?? [];

    const context = [`Activity half IS in scope: the ${shas.length} substantive commit(s) in the window — ${shas.join(', ')}.`];
    if (merged.length) context.push(`PRs merged in the window — read each one's diff and its review discussion: ${merged.map((n) => `#${n}`).join(', ')}.`);
    if (prs.length) context.push(`PRs touched in the window: ${prs.map((n) => `#${n}`).join(', ')}.`);
    if (issues.length) context.push(`Issues touched in the window: ${issues.map((n) => `#${n}`).join(', ')}.`);
    context.push('Conversation half IS in scope: a substantive merge means fresh captures on origin/conversation-logs — run the fresh pass over the recent window.');

    return { run: true, reason: `${shas.length} substantive commit(s) in the window`, context };
  },
};
