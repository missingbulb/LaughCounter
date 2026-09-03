import { finding } from '../../../engine/checks/helpers/findings.mjs';
import { stripComments } from '../../../engine/checks/helpers/code-scanning.mjs';

// `task.md` is one thing: the spec an agentic task's session follows (the
// writing-tasks skill, "The task folder"). A task that runs no agent
// (`agent_model: 'none'`, declared or derived) starts no session, so a `task.md`
// beside it is read by nobody — and it is not inert, because the rest of the
// corpus takes the file's presence as the fact that an agent runs here.
// `routine-structure` judges any folder holding one against the routine
// prose↔script contract; the engine builds every work item's `taskPath` as
// `<dir>/task.md` and validate-dispatch gates on that path existing, so the file
// answers a question about a session that is never started. The drift is
// invisible from the declaration side: both halves stay individually valid while
// they say opposite things.
//
// The fix is always a rename, never a deletion — the file's content is the
// human-facing record of what an agentless task's worker does, and `README.md`
// is what that is called (#1055).
//
// RELEVANCE FIRST (engine/checks/README.md): gated on a `tasks/<name>/task.json`
// (or the retired `task.mjs`) existing, so the rule is inert on any repo that
// carries no tasks. Static text over the self-contained file, the same read its
// two sibling rules use.
const TASK_DECLARATION = /(^|\/)tasks\/([^/]+)\/task\.(json|mjs)$/;

// Whether the declaration names a field at all, and a string field's value — a
// `task.json` parsed whole, a `task.mjs` lifted by pattern over comment-stripped
// source.
function fields(file, text) {
  if (file.endsWith('.json')) {
    let obj = null;
    try { obj = JSON.parse(text); } catch { obj = null; }
    return {
      has: (key) => Boolean(obj) && obj[key] !== undefined,
      str: (key) => (obj && typeof obj[key] === 'string' ? obj[key] : null),
    };
  }
  const code = stripComments(text);
  const at = (key) => new RegExp(`(?:^|[{,])\\s*${key}:\\s*`, 'm');
  return {
    has: (key) => at(key).test(code),
    str: (key) => {
      const m = new RegExp(`(?:^|[{,])\\s*${key}:\\s*['"]([^'"]+)['"]`, 'm').exec(code);
      return m ? m[1] : null;
    },
  };
}

// Whether the task runs an agent: a declared `agent_model` other than `none`. An
// absent one is `none` (the contract's default, packs/claudinite-tasks/task-defaults.mjs),
// spelled again here rather than imported because this pack does not require
// that one; the test beside this rule holds the two in step.
export function runsAgent(decl) {
  const declared = decl.str('agent_model');
  return declared !== null && declared !== 'none';
}

const rule = {
  id: 'task-md-only-when-agentic',
  severity: 'blocking',
  description: "A tasks/<name>/ folder holds a task.md only when its declaration runs an agent (agent_model !== 'none')",
  doc: 'packs/claudinite-growth/skills/writing-tasks/SKILL.md',
  why: 'task.md is the spec a task\'s session follows, and the corpus reads its presence as "an agent runs here" — on an agentless task it is prose no session will ever open, judged by the routine contract and named by every work item as the file the run is about',

  run(ctx) {
    const out = [];
    for (const file of ctx.files) {
      const m = TASK_DECLARATION.exec(file);
      if (!m) continue;
      const text = ctx.read(file);
      if (text === null) continue;
      if (runsAgent(fields(file, text))) continue;

      const taskDir = file.slice(0, file.lastIndexOf('/') + 1);
      if (!ctx.exists(`${taskDir}task.md`)) continue;
      out.push(finding(rule, {
        file: `${taskDir}task.md`,
        what: `sits beside a task declaration that runs no agent (agent_model 'none'), so no session will ever read it`,
        fix: `rename it to ${taskDir}README.md — an agentless task's doc is the human-facing record of what its worker does`,
      }));
    }
    return out;
  },
};

export default rule;
