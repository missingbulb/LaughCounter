import { patternRule } from '../../engine/checks/helpers/pattern-rules.mjs';
import { WORKFLOW_FILE } from '../../engine/checks/helpers/github-workflows.mjs';

export default patternRule({
  id: 'gha/unique-automation-branch',
  severity: 'advisory',
  description: 'An automated job needs a per-run-unique branch name, not a date-keyed one',
  doc: 'skills/git-github-advanced/SKILL.md',
  why: 'a date-keyed branch collides with itself on a repeat run for the same key',
  files: WORKFLOW_FILE,
  over: 'tracked',
  line: [{
    match: /checkout -b .*\$\(date/,
    unlessLine: /\$RANDOM|github\.run_id|github\.run_number|\$\{\{\s*github\.sha/,
    what: 'creates a branch keyed only by the date',
    fix: 'append a per-run-unique suffix ($RANDOM, github.run_id) to the branch name',
  }],
});
