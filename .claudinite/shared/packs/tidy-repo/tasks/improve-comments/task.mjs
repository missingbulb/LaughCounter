// tidy-repo task: improve-comments — the one tidy dimension whose subject is the
// repo's own source rather than its GitHub objects. The other three assess or act
// on issues, PRs and branches; this one reads a slice of the code AS COMMENTS and
// fixes what it finds there. Worker: task.md, which runs the improve-comments skill
// and nothing else.
//
// WHY IT IS A TASK AT ALL: a comment decays as the code around it changes and
// nothing makes it fail. No test goes red, no check fires, and no session working on
// something else will stop to fix one. The only way a repo's comments get read as
// comments is a pass whose whole job that is.
//
// WEEKLY. Comment drift is not latency-sensitive — a stale comment costs the next
// reader, whenever that is — and the window's commits are what name the files whose
// comments are likeliest wrong, so a weekly window is a bigger and better-targeted
// scope than a daily one for the same session cost.
//
// Self-contained (imports nothing): the whole contract is this default export.

// The pinned commit subject the run's own scope gate keys on, stated in task.md and
// enforced by the skill's `improve-comments-scope` check. Kept in step by the
// declaration test beside this pack's other tests.
const RUN_TITLE = 'Claudinite tidy: improve comments';

// How many of the window's changed files one round reads. A busy week can touch
// hundreds, and a session handed all of them skims; the rest are next round's, and
// the run says so rather than presenting a truncated list as the whole window.
const MAX_FILES = 40;

export default {
  id: 'improve-comments',
  frequency: 'weekly',                   // the weekly anchor (DESIGN §2); the window's commits are the scope
  precondition_signals: ['commits', 'prs'],
  agent_model: 'opus',                   // whether a comment carries a why the code cannot state is the judgment here, and a wrong call lands in the repo's source
  // Reviewed, never landed unattended. The scope check proves the diff is
  // comment-only, which is what makes the pass SAFE — it does not make the comments
  // themselves right, and a confidently wrong comment is the exact failure this task
  // exists to remove. A repo that wants these to land without review says so by
  // raising the ceiling here, in one line.
  expected_outcome: 'open-pr',
  agent_instructions: 'task.md',
  agent_execution_timeout: 1800,

  // Two gates, in order. Did anything land in the window — comments decay against
  // code, so a quiet week has nothing to re-read. Then: is this pass's previous PR
  // still open, in which case a second one would stack an unreviewed comment sweep
  // on an unreviewed comment sweep, over files the first one may already have
  // touched. Reading the pending PR's TITLE rather than a marker on the item means
  // a PR the owner opened by hand from this branch gates the round too.
  precondition(signals) {
    const openPrs = signals.prs?.open ?? [];
    const pending = openPrs.find((p) => String(p.title ?? '').startsWith(RUN_TITLE));
    if (pending) {
      return {
        run: false,
        reason: `PR #${pending.number} is this pass's previous round, still open — comments wait for its review rather than stack a second sweep on it`,
      };
    }

    const commits = signals.commits;
    if (!commits?.substantiveChange) {
      return { run: false, reason: 'no substantive commit in the window — nothing moved for a comment to have drifted from' };
    }
    const touched = commits.touchedPaths ?? [];
    if (!touched.length) {
      return { run: false, reason: 'the window\'s commits name no changed path — nothing to read' };
    }

    // A window can carry more files than one session should read as comments. Name
    // the cap and what it dropped rather than hand over a silently truncated list
    // that reads as the whole window.
    const scope = touched.slice(0, MAX_FILES);
    const dropped = touched.length - scope.length;
    return {
      run: true,
      reason: `${touched.length} path(s) changed in the window`,
      context: [
        `Read the comments in exactly these files, and no others: ${scope.join(', ')}.`,
        ...(dropped ? [`${dropped} further path(s) changed in the window and are NOT in scope this round — say so in the wrap-up so the next round is not read as a full sweep.`] : []),
        'A file whose comments are already right yields no edit — that is the common outcome and a good one.',
      ],
    };
  },
};
