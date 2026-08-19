import { finding } from '../../engine/checks/helpers/findings.mjs';
import { stripComments } from '../../engine/checks/helpers/code-scanning.mjs';
import { CODE_WORK_ENV_VARS } from '../../engine/scheduler/queue/code-work-run.mjs';

// A task's code may read only the CLAUDINITE_* variables code-work is actually
// handed (`codeWorkEnv`, tasks-dispatch DESIGN §6.5). Anything else is a variable
// nobody sets, which fails in the one way nothing catches: `process.env.X` is
// `undefined`, the worker's parse of it yields an empty result, and the run goes
// green having quietly done something other than what it was asked.
//
// That is not hypothetical. Three fleet tasks took their parameters through
// `CLAUDINITE_OVERRIDES`, the slot scheduler's manual-run bag, which the queue has
// never set — so `REPOS` could not bound a sweep and `DRY_RUN` could not withhold
// its writes, and every run of the fleet-wide baseline lever was unscoped and live
// (#974). A dropped parameter channel defaults to the operation's most dangerous
// mode, not a safe one.
//
// GENERIC BY CONSTRUCTION: the legal set is the key set of the object the executor
// builds, imported rather than restated, so a variable added to or removed from the
// code-work contract changes what this accepts with no edit here.
// A task's own code. Tests are out: a test naming a retired variable is naming it
// as a fixture, which is exactly what a regression test for this rule must be free
// to do.
const TASK_FILE = /(^|\/)tasks\/[^/]+\/.+\.mjs$/;
const TEST_FILE = /\.test\.mjs$/;
const READS = /\bCLAUDINITE_[A-Z0-9_]+\b/g;

const rule = {
  id: 'task-code-work-env',
  severity: 'blocking',
  description: 'A task\'s code reads only the CLAUDINITE_* environment variables code_work is handed (CLAUDINITE_REPO_ROOT, CLAUDINITE_REPO, CLAUDINITE_DEFAULT_BRANCH, CLAUDINITE_ITEM, CLAUDINITE_PACK, CLAUDINITE_TASK, CLAUDINITE_CONTEXT, CLAUDINITE_REQUEST_AGENT)',
  doc: 'packs/claudinite-growth/scheduled-tasks.md',
  why: 'a variable nothing sets reads as undefined and the run still goes green — a parameter channel that has stopped being delivered leaves the operation in its unscoped, unguarded mode with no signal at all',

  run(ctx) {
    const out = [];
    for (const file of ctx.files.filter((f) => TASK_FILE.test(f) && !TEST_FILE.test(f))) {
      const text = ctx.read(file);
      if (text === null) continue;
      // Comments strip in BOTH directions: this rule's own prose names the retired
      // variable, and so does any note explaining why a task stopped reading one.
      const seen = new Set(stripComments(text).match(READS) ?? []);
      for (const name of [...seen].sort()) {
        if (CODE_WORK_ENV_VARS.includes(name)) continue;
        out.push(finding(rule, {
          file,
          what: `reads \`${name}\`, which code_work never sets`,
          fix: `take the value from the item's Context (\`CLAUDINITE_CONTEXT\`, one line per bullet, set by \`create-work-item --context\`) — the code_work contract sets ${CODE_WORK_ENV_VARS.join(', ')} and nothing else`,
        }));
      }
    }
    return out;
  },
};

export default rule;
