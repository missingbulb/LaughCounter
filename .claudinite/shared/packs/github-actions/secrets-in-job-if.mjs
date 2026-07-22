import { finding } from '../../engine/checks/helpers/findings.mjs';
import { workflowFiles } from '../../engine/checks/helpers/github-workflows.mjs';

const rule = {
  id: 'gha/secrets-in-job-if',
  severity: 'blocking',
  description: 'A job-level if: cannot read secrets.* — the job fails red instead of skipping',
  doc: 'skills/git-github-advanced/SKILL.md',
  why: 'secrets are not available in a job-level if:, so the condition cannot evaluate and the job fails instead of skipping',

  run(ctx) {
    const out = [];
    for (const wf of workflowFiles(ctx)) {
      const text = ctx.read(wf);
      if (text === null) continue;
      // An if: at or above the current steps: indent is job-level; below it is step-level.
      let stepsIndent = -1;
      text.split('\n').forEach((line, i) => {
        const steps = /^(\s*)steps:\s*$/.exec(line);
        if (steps) { stepsIndent = steps[1].length; return; }
        if (/^\s{0,2}\S/.test(line)) stepsIndent = -1; // new job or top-level key
        const m = /^(\s*)if:\s*(.*)$/.exec(line);
        if (m && /secrets\./.test(m[2]) && (stepsIndent === -1 || m[1].length <= stepsIndent)) {
          out.push(finding(rule, {
            file: wf, line: i + 1,
            what: `job-level if: reads ${/secrets\.\w+/.exec(m[2])?.[0] ?? 'secrets.*'}`,
            fix: 'put the non-sensitive flag in a repository variable and gate with vars.* (if: ${{ vars.X != \'\' }}); keep the secret for the steps inside the job',
          }));
        }
      });
    }
    return out;
  },
};

export default rule;
