import { finding } from '../../../engine/checks/helpers/findings.mjs';
import { stripComments } from '../../../engine/checks/helpers/code-scanning.mjs';
import { FREQUENCIES } from '../../claudinite-tasks/calendar.mjs';
import { MODEL_FAMILIES } from '../../claudinite-tasks/model-map.mjs';
import { OUTCOMES, LEGACY_OUTCOMES, SIGNAL_NAMES } from '../../claudinite-tasks/task-contract.mjs';

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

// A file that only re-exports another module declares nothing of its own — a
// legacy-path shim left behind by a relocation is the shape. The declaration it
// names is scanned where it actually lives, so judging the shim would report the
// same task twice and fail it on text it does not carry.
const isReExport = (text) => {
  const code = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//'));
  return code.length > 0 && code.every((l) => /^(import|export)\b.*\bfrom\b/.test(l) || /^import\s+['"]/.test(l));
};

// The value of a top-level `key: 'value'` string field, or null if absent.
const strField = (text, key) => {
  const m = new RegExp(`\\b${key}:\\s*['"]([^'"]+)['"]`).exec(text);
  return m ? m[1] : null;
};

const rule = {
  id: 'task-declaration-shape',
  severity: 'blocking',
  description: 'A tasks/<name>/task.mjs default-exports the full task contract (id, frequency, precondition_signals, agent_model, expected_outcome, agent_instructions, precondition) with legal enum values; a pr task pairs its ceiling with a automerge policy, an agentic task bounds its run with agent_execution_timeout, and any code_work carries a timeout and stays task-local',
  doc: 'packs/claudinite-tasks/README.md',
  why: 'the scheduler run and executor read agent_model/expected_outcome/frequency from this file, not the work item — an illegal or missing value means a task never fires, fires wrong, or writes past its ceiling',

  run(ctx) {
    const out = [];
    for (const file of ctx.files.filter((f) => TASK_MJS.test(f))) {
      const text = ctx.read(file);
      if (text === null || isReExport(text)) continue;
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

      // expected_outcome takes the ceiling/policy split, with the retired
      // one-word ceilings an ADVISORY rename like the code-work names below:
      // the runtime normalizes them at the door forever, so a member's vendor
      // refresh must not turn its CI red over a declaration nobody edited.
      const outcome = strField(text, 'expected_outcome');
      const hasMayAutomerge = /\bautomerge:\s*/.test(stripComments(text));
      if (outcome === null) {
        flag('declares no "expected_outcome"', `add "expected_outcome": one of ${OUTCOMES.join(', ')}`);
      } else if (LEGACY_OUTCOMES[outcome] !== undefined) {
        out.push(finding(rule, {
          file,
          severity: 'advisory',
          what: `declares the legacy outcome ceiling "${outcome}"`,
          fix: `write the pair it normalizes to: expected_outcome: 'pr', automerge: '${LEGACY_OUTCOMES[outcome]}' — and consider a narrower policy than '${LEGACY_OUTCOMES[outcome]}' (a list of diff classes, e.g. ['comment-only-changes'])`,
        }));
      } else if (!OUTCOMES.includes(outcome)) {
        flag(`"expected_outcome" is "${outcome}", not a legal value`, `use one of: ${OUTCOMES.join(', ')}`);
      } else if (outcome === 'pr' && !hasMayAutomerge) {
        flag('a "pr" task declares no "automerge"', 'say what may land unreviewed: "nothing", "anything", or a list of diff classes, e.g. ["comment-only-changes", "readme-changes"]');
      } else if (outcome === 'none' && hasMayAutomerge) {
        flag('a "none" task declares "automerge"', 'drop it — a task that opens no pull request has nothing to merge; or set expected_outcome: "pr"');
      }

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

      // The code-work/timeout guards (task-code-work DESIGN §2). Numeric presence is
      // a cheap `<key>: <digit>` regex, matching the runtime contract. TWO
      // generations of legacy field names still satisfy the contract — the loader
      // normalizes both — but each earns its own rename finding so the fleet
      // converges on the canonical names.
      const hasNum = (...keys) => keys.some((key) => new RegExp(`\\b${key}:\\s*\\d`).test(text));
      const LEGACY_CODE_WORK = [
        { field: 'agent_preprocessing', timeout: 'agent_preprocessing_timeout' },
        { field: 'prework', timeout: 'prework_timeout' },
      ];
      const legacyDeclared = LEGACY_CODE_WORK.filter(({ field }) => new RegExp(`\\b${field}:\\s*['"]`).test(text));
      const hasCodeWork = /\bcode_work:\s*['"]/.test(text) || legacyDeclared.length > 0;
      for (const { field, timeout } of legacyDeclared) {
        // ADVISORY, deliberately, on a blocking rule: the legacy names still
        // satisfy the runtime contract (normalized at load), and a member's
        // vendor refresh must not turn its CI red over files nothing has renamed
        // yet. This finding IS the durable driver of the rename — it names the
        // exact edit and does not age out, which is why neither rename ships a
        // migration note.
        out.push(finding(rule, {
          file,
          severity: 'advisory',
          what: `declares code_work under the legacy name "${field}"`,
          fix: `rename "${field}" → "code_work" and "${timeout}" → "code_work_timeout" (the two phases of task execution are code-work, then agentic-work — neither is named for the other)`,
        }));
      }
      // The ordering field's rename. ADVISORY for the same reason as the code-work rename above:
      // the runtime normalizes it at the door, so a member's own task file keeps working and its
      // CI must not go red over a declaration nobody has edited. Worth making because the bare
      // preposition invited reading the field as a time — it is not one; it names task ids, and
      // what it steers is when the item is scheduled onto an executor.
      //
      // The regex is anchored on a NON-word character before the key so it cannot match the
      // canonical spelling's own tail.
      if (/(?<![\w.])after:\s*\[/.test(text)) {
        out.push(finding(rule, {
          file,
          severity: 'advisory',
          what: 'declares its ordering under the legacy name "after"',
          fix: 'rename "after" to "schedule_after" (it names task ids, not a time — what it steers is when this item is scheduled onto an executor)',
        }));
      }
      // `session_scope` lost its last reader with the slot scheduler (#974): the
      // queue routes a hand-off by `invocation_endpoint`, and nothing anywhere
      // asks a task what its scope is. ADVISORY, like the code-work rename above and
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
          fix: 'drop it — reach is a property of which endpoint the hand-off calls, so a task needing wider access declares "invocation_endpoint": <a key in the repo\'s taskScheduler.agenticTaskInvocationEndpoints> instead',
        }));
      }
      if (model && MODEL_FAMILIES.includes(model) && model !== 'none' && !hasNum('agent_execution_timeout')) {
        flag('an agentic task (agent_model !== "none") declares no numeric "agent_execution_timeout"', 'add "agent_execution_timeout": seconds bounding the agentic run');
      }
      if (model === 'none' && !hasCodeWork) {
        flag('an agentless task (agent_model: "none") declares no "code_work"', 'add "code_work" (a none task does its work in that subprocess) — or give the task an agent_model');
      }
      if (hasCodeWork) {
        const prep = LEGACY_CODE_WORK.reduce((found, { field }) => found ?? strField(text, field), strField(text, 'code_work'));
        if (prep && (/(^|\s)\//.test(prep) || prep.includes('..'))) {
          flag('"code_work" reaches outside the task directory (absolute path or "..")', 'reference a sibling script only, e.g. "node prepare.mjs"');
        }
        if (!hasNum('code_work_timeout', ...LEGACY_CODE_WORK.map(({ timeout }) => timeout))) {
          flag('"code_work" is set but declares no numeric "code_work_timeout"', 'add "code_work_timeout": seconds after which the subprocess is killed');
        }
      }
    }
    return out;
  },
};

export default rule;
