import { finding } from '../../engine/checks/helpers/findings.mjs';
import { stripComments } from '../../engine/checks/helpers/code-scanning.mjs';
import { FREQUENCIES } from '../../engine/scheduler/calendar.mjs';
import { MODEL_FAMILIES } from '../../engine/scheduler/model-map.mjs';
import { OUTCOMES, SIGNAL_NAMES } from '../../engine/scheduler/task-contract.mjs';

// Every scheduler task is a `tasks/<name>/task.mjs` whose default export carries
// the full declaration contract (per-project-scheduling DESIGN §1) with legal
// enum values. This asserts that shape statically at author time — the executor
// and scheduler validate the same contract at run time (task-contract.mjs), so
// an illegal frequency/model/outcome, or a missing field, is caught here first.
//
// RELEVANCE FIRST (engine/checks/README.md): gated on a `tasks/<name>/task.mjs`
// existing, so the check is inert on any repo without tasks. Static text over
// the self-contained module (task.mjs imports nothing), keyed off the canonical
// enum lists so the legal values never drift from the runtime validator.
const TASK_MJS = /(^|\/)tasks\/[^/]+\/task\.mjs$/;

// The value of a top-level `key: 'value'` string field, or null if absent.
const strField = (text, key) => {
  const m = new RegExp(`\\b${key}:\\s*['"]([^'"]+)['"]`).exec(text);
  return m ? m[1] : null;
};

const rule = {
  id: 'task-declaration-shape',
  severity: 'blocking',
  description: 'A tasks/<name>/task.mjs default-exports the full task contract (id, frequency, precondition_signals, agent_model, expected_outcome, agent_instructions, precondition) with legal enum values; an agentic task bounds its run with agent_execution_timeout, and any prework carries a timeout and stays task-local',
  doc: 'packs/core/scheduled-tasks.md',
  why: 'the tick and executor read agent_model/expected_outcome/frequency from this file, not the work item — an illegal or missing value means a task never fires, fires wrong, or writes past its ceiling',

  run(ctx) {
    const out = [];
    for (const file of ctx.files.filter((f) => TASK_MJS.test(f))) {
      const text = ctx.read(file);
      if (text === null) continue;
      const flag = (what, fix) => out.push(finding(rule, { file, what, fix }));
      const model = strField(text, 'agent_model');

      if (!/export\s+default\s*\{/.test(text)) {
        flag('does not default-export a declaration object', 'export default { id, frequency, precondition_signals, agent_model, expected_outcome, agent_instructions, precondition }');
        continue;
      }
      const enumField = (key, legal) => {
        const v = strField(text, key);
        if (v === null) flag(`declares no "${key}"`, `add "${key}": one of ${legal.join(', ')}`);
        else if (!legal.includes(v)) flag(`"${key}" is "${v}", not a legal value`, `use one of: ${legal.join(', ')}`);
      };
      enumField('frequency', FREQUENCIES);
      enumField('agent_model', MODEL_FAMILIES);
      enumField('expected_outcome', OUTCOMES);

      if (!/\bid:\s*['"]/.test(text)) flag('declares no string "id"', 'add "id": the task name (matching its directory)');
      // agent_instructions is required only for an agentic task (agent_model !==
      // 'none') — that's the worker file the agent reads. A `none` task runs no
      // agent, so the field is not applicable.
      if (model !== 'none' && !/\bagent_instructions:\s*['"]/.test(text)) {
        flag('an agentic task (agent_model !== "none") declares no string "agent_instructions"', 'add "agent_instructions": the worker file beside task.mjs (e.g. "task.md")');
      }
      if (!/\bprecondition_signals:\s*\[/.test(text)) {
        flag('declares no "precondition_signals" array', `add "precondition_signals": an array of ${SIGNAL_NAMES.join(', ')}`);
      }
      if (!/\bprecondition\s*[:(]/.test(text)) {
        flag('declares no "precondition" function', 'add a precondition(signals, config) that returns { run, reason, context? }');
      }

      // The prework/timeout guards (task-prework DESIGN §2). Numeric presence is
      // a cheap `<key>: <digit>` regex, matching the runtime contract. The legacy
      // field names (`agent_preprocessing[_timeout]`, pre-2026-08-06) still
      // satisfy the contract — the loader normalizes them — but earn their own
      // rename finding so the fleet converges on the canonical names.
      const hasNum = (...keys) => keys.some((key) => new RegExp(`\\b${key}:\\s*\\d`).test(text));
      const legacyPrework = /\bagent_preprocessing:\s*['"]/.test(text);
      const hasPrework = /\bprework:\s*['"]/.test(text) || legacyPrework;
      if (legacyPrework) {
        // ADVISORY, deliberately, on a blocking rule: the legacy names still
        // satisfy the runtime contract (normalized at load), and a member's
        // vendor refresh must not turn its CI red over files nothing has renamed
        // yet — the 2026-08-06 migration note drives the rename; this finding
        // only keeps it visible until it lands.
        out.push(finding(rule, { file, severity: 'advisory', what: 'declares prework under the legacy name "agent_preprocessing"', fix: 'rename "agent_preprocessing" → "prework" and "agent_preprocessing_timeout" → "prework_timeout" (the phases of task execution are prework, then agentic work)' }));
      }
      // `session_scope` lost its last reader with the slot scheduler (#974): the
      // queue routes a hand-off by `invocation_endpoint`, and nothing anywhere
      // asks a task what its scope is. ADVISORY, like the prework rename above and
      // for the same reason — the field still VALIDATES, so a member's vendor
      // refresh must not turn its CI red over a declaration nobody has edited yet;
      // this only keeps the dead field visible until it is dropped.
      // Comments stripped: this rule's own remedy names the field, and so does any
      // note explaining why a task stopped declaring one.
      if (/\bsession_scope:\s*['"]/.test(stripComments(text))) {
        out.push(finding(rule, {
          file,
          severity: 'advisory',
          what: 'declares "session_scope", which nothing reads',
          fix: 'drop it — reach is a property of which endpoint the hand-off calls, so a task needing wider access declares "invocation_endpoint": <a key in the repo\'s taskScheduler.endpoints> instead',
        }));
      }
      if (model && MODEL_FAMILIES.includes(model) && model !== 'none' && !hasNum('agent_execution_timeout')) {
        flag('an agentic task (agent_model !== "none") declares no numeric "agent_execution_timeout"', 'add "agent_execution_timeout": seconds bounding the agentic run');
      }
      if (model === 'none' && !hasPrework) {
        flag('an agentless task (agent_model: "none") declares no "prework"', 'add "prework" (a none task does its work in that subprocess) — or give the task an agent_model');
      }
      if (hasPrework) {
        const prep = strField(text, 'prework') ?? strField(text, 'agent_preprocessing');
        if (prep && (/(^|\s)\//.test(prep) || prep.includes('..'))) {
          flag('"prework" reaches outside the task directory (absolute path or "..")', 'reference a sibling script only, e.g. "node prepare.mjs"');
        }
        if (!hasNum('prework_timeout', 'agent_preprocessing_timeout')) {
          flag('"prework" is set but declares no numeric "prework_timeout"', 'add "prework_timeout": seconds after which the subprocess is killed');
        }
      }
    }
    return out;
  },
};

export default rule;
