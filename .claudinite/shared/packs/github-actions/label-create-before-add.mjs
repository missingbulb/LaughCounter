import { finding } from '../../engine/checks/helpers/findings.mjs';
import { workflowFiles } from '../../engine/checks/helpers/github-workflows.mjs';

const rule = {
  id: 'gha/label-create-before-add',
  severity: 'advisory',
  description: 'A workflow applying a label should create it idempotently first',
  doc: 'skills/git-github-advanced/SKILL.md',
  why: '--add-label fails when the label does not exist yet — GitHub will not create it on demand',

  run(ctx) {
    const out = [];
    for (const wf of workflowFiles(ctx)) {
      const text = ctx.read(wf);
      if (text === null) continue;
      if (/--add-label/.test(text) && !/label create/.test(text)) {
        out.push(finding(rule, {
          file: wf,
          what: 'uses --add-label with no idempotent `gh label create … || true` beforehand',
          fix: 'create the label idempotently before adding it, so the workflow survives its first run',
        }));
      }
    }
    return out;
  },
};

export default rule;
