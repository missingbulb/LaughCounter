import { finding } from '../../engine/checks/helpers/findings.mjs';

// The other half of the scheduled-task contract (scheduled-tasks.md, "Every task
// declaration carries the full contract" + "The task folder"): the declaration
// and the folder it sits in must AGREE. `task-declaration-shape` asserts the
// declaration's own shape — that `id` and `agent_instructions` are present and
// the enums are legal — and stops at the file's edge; this rule is the
// cross-artifact invariant between that file and the tree around it.
//
// Why it is its own rule rather than more of that one: both faces fail the same
// way, and it is the way a shape error does NOT fail. Discovery
// (engine/scheduler/discover.mjs) is fail-soft per task — a task whose declared
// `id` differs from its directory name is dropped into `errors` and simply never
// runs, and a dangling `agent_instructions` hands the executor a worker doc that
// isn't there. Nothing goes red; the scheduler keeps reporting healthy runs while
// the task is silently absent from every one of them. That is the class this
// repo's own canon names as the expensive one, so it is worth catching where it
// is cheap: at author time, in the session that wrote the file.
//
// RELEVANCE FIRST (engine/checks/README.md): gated on a `tasks/<name>/task.mjs`
// existing, so the rule is inert on any repo that schedules nothing. Static text
// over the self-contained module (task.mjs imports nothing), the same parse the
// shape rule uses, so the two views of one file can't disagree.
const TASK_MJS = /(^|\/)tasks\/([^/]+)\/task\.mjs$/;

// The value of a top-level `key: 'value'` string field, or null if absent.
const strField = (text, key) => {
  const m = new RegExp(`\\b${key}:\\s*['"]([^'"]+)['"]`).exec(text);
  return m ? m[1] : null;
};

const rule = {
  id: 'task-declaration-matches-folder',
  severity: 'blocking',
  description: "A tasks/<name>/task.mjs declares the id of its own directory, and its agent_instructions names a worker file that exists beside it",
  doc: 'packs/core/scheduled-tasks.md',
  why: 'task discovery is fail-soft per task — a declaration that disagrees with its folder is dropped into errors and the task silently never runs, while every scheduler run keeps reporting healthy',

  run(ctx) {
    const out = [];
    for (const file of ctx.files) {
      const m = TASK_MJS.exec(file);
      if (!m) continue;
      const dirName = m[2];
      const text = ctx.read(file);
      if (text === null) continue;
      const flag = (what, fix) => out.push(finding(rule, { file, what, fix }));

      const id = strField(text, 'id');
      if (id !== null && id !== dirName) {
        flag(
          `declares id "${id}" but its directory is "${dirName}"`,
          `rename the directory to "${id}", or set the id to "${dirName}" — the two must match`,
        );
      }

      // The worker doc the executing agent reads. Resolved relative to the task
      // folder, which is the only place it may live (the declaration contract
      // keeps a task self-contained), so a value that escapes the folder is
      // dangling by definition and reported as such.
      const worker = strField(text, 'agent_instructions');
      if (worker) {
        const taskDir = file.slice(0, file.length - 'task.mjs'.length);
        if (worker.startsWith('/') || worker.split('/').includes('..')) {
          flag(
            `declares agent_instructions "${worker}", which reaches outside the task directory`,
            `keep the worker doc beside task.mjs (conventionally "task.md") — a task folder is self-contained`,
          );
        } else if (!ctx.exists(`${taskDir}${worker}`)) {
          flag(
            `declares agent_instructions "${worker}", which does not exist in ${taskDir}`,
            `add ${taskDir}${worker}, or point agent_instructions at the worker doc that is there (conventionally "task.md")`,
          );
        }
      }
    }
    return out;
  },
};

export default rule;
