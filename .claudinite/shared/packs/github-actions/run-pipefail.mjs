import { finding } from '../../engine/checks/helpers/findings.mjs';
import { workflowFiles } from '../../engine/checks/helpers/github-workflows.mjs';

// A single | between non-| characters is a shell pipe; || is the or-operator.
const PIPE = /(^|[^|])\|([^|]|$)/;

const rule = {
  id: 'gha/run-pipefail',
  severity: 'blocking',
  description: 'A workflow piping in run: steps needs shell: bash — the default shell has no pipefail',
  doc: 'skills/git-github-advanced/SKILL.md',
  why: "GitHub's implicit run shell is bash -e without pipefail, so a failing piped command still shows the step green",

  run(ctx) {
    const out = [];
    for (const wf of workflowFiles(ctx)) {
      const text = ctx.read(wf);
      if (text === null || /shell:\s*bash/.test(text)) continue;
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        const inline = /^(\s*)(?:-\s+)?run:\s*(.+)$/.exec(lines[i]);
        if (!inline) continue;
        const runIndent = inline[1].length;
        let commands = [];
        if (/^[|>][+-]?\s*$/.test(inline[2])) {
          for (let j = i + 1; j < lines.length; j += 1) {
            if (lines[j].trim() && !/^\s+/.test(lines[j])) break;
            if (lines[j].trim() && lines[j].search(/\S/) <= runIndent) break;
            commands.push(lines[j]);
            if (!lines[j].trim()) continue;
          }
        } else {
          commands = [inline[2]];
        }
        if (commands.some((c) => PIPE.test(c))) {
          out.push(finding(rule, {
            file: wf, line: i + 1,
            what: 'a piped run: step in a workflow with no bash shell default',
            fix: 'add defaults.run.shell: bash (workflow- or job-level) so the step runs with -o pipefail',
          }));
        }
      }
    }
    return out;
  },
};

export default rule;
