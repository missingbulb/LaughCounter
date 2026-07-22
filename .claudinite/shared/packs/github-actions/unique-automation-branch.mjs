import { finding } from '../../engine/checks/helpers/findings.mjs';
import { workflowFiles } from '../../engine/checks/helpers/github-workflows.mjs';

const UNIQUE = /\$RANDOM|github\.run_id|github\.run_number|\$\{\{\s*github\.sha/;

const rule = {
  id: 'gha/unique-automation-branch',
  severity: 'advisory',
  description: 'An automated job needs a per-run-unique branch name, not a date-keyed one',
  doc: 'skills/git-github-advanced/SKILL.md',
  why: 'a date-keyed branch collides with itself on a repeat run for the same key',

  run(ctx) {
    const out = [];
    for (const wf of workflowFiles(ctx)) {
      const text = ctx.read(wf);
      if (text === null) continue;
      text.split('\n').forEach((line, i) => {
        if (/checkout -b [^\n]*\$\(date/.test(line) && !UNIQUE.test(line)) {
          out.push(finding(rule, {
            file: wf, line: i + 1,
            what: 'creates a branch keyed only by the date',
            fix: 'append a per-run-unique suffix ($RANDOM, github.run_id) to the branch name',
          }));
        }
      });
    }
    return out;
  },
};

export default rule;
