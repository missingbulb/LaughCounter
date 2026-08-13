import { patternRule } from '../../engine/checks/helpers/pattern-rules.mjs';
import { WORKFLOW_FILE } from '../../engine/checks/helpers/github-workflows.mjs';

export default patternRule({
  id: 'gha/scheduled-failure-escalation',
  severity: 'advisory',
  description: 'A scheduled workflow must escalate its own failure to a human-visible state',
  doc: 'skills/git-github-advanced/SKILL.md',
  why: 'nobody watches a scheduled run — a red run in the Actions list reaches no one',
  files: WORKFLOW_FILE,
  over: 'tracked',
  file: [{
    if: /^\s*schedule:/m,
    require: /failure\(\)|report-failure/,
    what: 'runs on a schedule but has no visible failure escalation (no failure() job, no report-failure call)',
    fix: 'add a job that runs on failure() and opens a workflow-failure tracking issue a human will see (or use the shared report-failure action)',
  }],
});
