import { patternRule } from '../../engine/checks/helpers/pattern-rules.mjs';
import { WORKFLOW_FILE } from '../../engine/checks/helpers/github-workflows.mjs';

export default patternRule({
  id: 'gha/pages-artifact-symlinks',
  severity: 'blocking',
  description: 'A GitHub Pages artifact that uploads the repo root must prune the agent-tooling dirs (their skill symlinks dangle in CI)',
  doc: 'bootstrap.md',
  why: 'upload-pages-artifact tars with --dereference and fails on the dangling .claude/skills/* symlinks, blocking every deploy',
  gate: { tracked: /^\.claude\/skills\//, notTracked: /^\.claudinite\/skills\// },
  files: WORKFLOW_FILE,
  over: 'tracked',
  file: [{
    if: [/uses:\s*actions\/upload-pages-artifact/, /^\s*path:\s*['"]?\.\/?['"]?\s*$/m],
    require: /\brm\b[^\n]*\.claude/,
    what: 'uploads the repo root (path: .) to actions/upload-pages-artifact, but .claude/skills/* are symlinks into the gitignored .claudinite/ corpus (empty in CI) — they dangle and the action tars with --dereference, so the deploy fails',
    fix: 'add a step before the upload that prunes the agent tooling: `run: rm -rf .claude .claudinite` (never part of a published site)',
  }],
});
