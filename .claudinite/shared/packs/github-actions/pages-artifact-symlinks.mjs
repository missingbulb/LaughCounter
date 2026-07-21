import { finding } from '../../engine/checks/helpers/findings.mjs';
import { workflowFiles } from '../../engine/checks/helpers/github-workflows.mjs';

// A GitHub Pages deploy that uploads the repo root fails in CI because
// Claudinite mounts its skills as symlinks (.claude/skills/* -> the gitignored
// .claudinite/ corpus, which is empty on a runner since the sync hook never runs
// there). actions/upload-pages-artifact tars with --dereference, which follows
// the dangling links and errors — silently blocking every deploy. The fix is to
// prune the agent-tooling dirs from the artifact before upload.
const rule = {
  id: 'gha/pages-artifact-symlinks',
  severity: 'blocking',
  description: 'A GitHub Pages artifact that uploads the repo root must prune the agent-tooling dirs (their skill symlinks dangle in CI)',
  doc: 'bootstrap.md',
  why: 'upload-pages-artifact tars with --dereference and fails on the dangling .claude/skills/* symlinks, blocking every deploy',

  run(ctx) {
    // The hazard exists only where the skills are mounted as symlinks into the
    // gitignored corpus: .claude/skills/* is tracked, .claudinite/skills/* is not,
    // so those links dangle on a fresh CI checkout.
    const mountsSkillSymlinks =
      ctx.tracked.some((f) => /^\.claude\/skills\//.test(f)) &&
      !ctx.tracked.some((f) => /^\.claudinite\/skills\//.test(f));
    if (!mountsSkillSymlinks) return [];

    const out = [];
    for (const wf of workflowFiles(ctx)) {
      const text = ctx.read(wf);
      if (text === null) continue;
      if (!/uses:\s*actions\/upload-pages-artifact/.test(text)) continue;
      // Only the whole-tree upload (path: .) drags the dangling links into the
      // tar; a dedicated build dir (the action's default, or path: _site) is safe.
      if (!/^\s*path:\s*['"]?\.\/?['"]?\s*$/m.test(text)) continue;
      // A step that removes the tooling dirs before upload defuses it.
      if (/\brm\b[^\n]*\.claude/.test(text)) continue;
      out.push(finding(rule, {
        file: wf,
        what: 'uploads the repo root (path: .) to actions/upload-pages-artifact, but .claude/skills/* are symlinks into the gitignored .claudinite/ corpus (empty in CI) — they dangle and the action tars with --dereference, so the deploy fails',
        fix: 'add a step before the upload that prunes the agent tooling: `run: rm -rf .claude .claudinite` (never part of a published site)',
      }));
    }
    return out;
  },
};

export default rule;
