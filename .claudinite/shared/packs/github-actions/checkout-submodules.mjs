import { finding } from '../../engine/checks/helpers/findings.mjs';
import { workflowFiles } from '../../engine/checks/helpers/github-workflows.mjs';

const rule = {
  id: 'gha/checkout-submodules',
  severity: 'blocking',
  description: 'In a repo with submodules, every actions/checkout must pass submodules: true',
  doc: 'skills/git-github-advanced/SKILL.md',
  why: 'checkout does not fetch submodules by default, so any gate reading submodule content passes vacuously',

  run(ctx) {
    if (!ctx.exists('.gitmodules')) return [];
    const out = [];
    for (const wf of workflowFiles(ctx)) {
      const text = ctx.read(wf);
      if (text === null) continue;
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        if (!/uses:\s*actions\/checkout@/.test(lines[i])) continue;
        const stepIndent = lines[i].search(/\S/);
        let covered = false;
        for (let j = i + 1; j < lines.length; j += 1) {
          if (lines[j].trim() && lines[j].search(/\S/) <= stepIndent) break; // next step/key
          if (/submodules:\s*(true|recursive)/.test(lines[j])) { covered = true; break; }
        }
        if (!covered) {
          out.push(finding(rule, {
            file: wf, line: i + 1,
            what: 'actions/checkout without submodules: true in a repo that has .gitmodules',
            fix: 'add `with: submodules: true` (or recursive) to this checkout step',
          }));
        }
      }
    }
    return out;
  },
};

export default rule;
