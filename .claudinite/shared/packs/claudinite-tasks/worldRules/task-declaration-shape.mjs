import { finding } from '../../../engine/checks/helpers/findings.mjs';
import { stripComments } from '../../../engine/checks/helpers/code-scanning.mjs';
import { FREQUENCIES } from '../../claudinite-tasks/calendar.mjs';
import { MODEL_FAMILIES } from '../../claudinite-tasks/model-map.mjs';
import { OUTCOMES, LEGACY_OUTCOMES, DEFAULT_AGENT_MODEL, descriptionProblem } from '../../claudinite-tasks/task-contract.mjs';
import { validatePreconditions, termsMap } from '../../claudinite-tasks/precondition-policy.mjs';
import {
  TASK_DECLARATION_PATH_RE, isLegacyTaskDeclarationPath, readDeclarationFields,
} from '../../claudinite-tasks/task-declaration-text.mjs';

// Every scheduler task is a `tasks/<name>/task.json` carrying the declaration
// contract (per-project-scheduling DESIGN §1) with legal enum values. This
// asserts that shape statically at author time — the executor and scheduler
// validate the same contract at run time (task-contract.mjs), so an illegal
// frequency/model/outcome, or a missing field, is caught here first.
//
// RELEVANCE FIRST (engine/checks/README.md): gated on a task declaration file
// existing, so the check is inert on any repo without tasks. Static text over the
// self-contained file — a `task.json` parsed whole, the retired `task.mjs` lifted
// by pattern — keyed off the canonical enum lists so the legal values never drift
// from the runtime validator.

// The term names the task's own `preconditions.mjs` exports, read as text: the
// check runs over a file listing, not a module graph, so it recognises a
// task-local condition by the key that defines it. A term the file computes
// rather than spells is not found, and its declaration reads as unknown — which
// is the same "write it so a reader can see it" the literal rule above states.
function siblingTerms(ctx, taskFile) {
  const text = ctx.read(taskFile.replace(/task\.(json|mjs)$/, 'preconditions.mjs'));
  if (text === null) return new Map();
  const body = stripComments(text);
  const start = body.indexOf('export const terms');
  if (start === -1) return new Map();
  const names = [...body.slice(start).matchAll(/^  '([^']+)':/gm)].map((m) => m[1]);
  return termsMap(Object.fromEntries(names.map((n) => [n, { signals: [] }])));
}

// A file that only re-exports another module declares nothing of its own — a
// legacy-path shim left behind by a relocation is the shape. The declaration it
// names is scanned where it actually lives, so judging the shim would report the
// same task twice and fail it on text it does not carry.
const isReExport = (text) => {
  const code = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//'));
  return code.length > 0 && code.every((l) => /^(import|export)\b.*\bfrom\b/.test(l) || /^import\s+['"]/.test(l));
};

const rule = {
  id: 'task-declaration-shape',
  severity: 'blocking',
  description: 'A tasks/<name>/task.json carries the task contract (id, description, frequency, expected_outcome) with legal enum values and a well-formed precondition expression; an agentic task names its worker file and bounds its run, and any code_work carries a timeout and stays task-local',
  doc: 'packs/claudinite-tasks/README.md',
  why: 'the scheduler run and executor read agent_model/expected_outcome/frequency from this file, not the work item — an illegal or missing value means a task never fires, fires wrong, or writes past its ceiling',

  run(ctx) {
    const out = [];
    for (const file of ctx.files.filter((f) => TASK_DECLARATION_PATH_RE.test(f))) {
      const text = ctx.read(file);
      if (text === null) continue;
      const flag = (what, fix) => out.push(finding(rule, { file, what, fix }));
      const advise = (what, fix) => out.push(finding(rule, { file, severity: 'advisory', what, fix }));

      const legacy = isLegacyTaskDeclarationPath(file);
      if (legacy) {
        if (isReExport(text)) continue;
        // ADVISORY, like every other retired spelling here: the runtime still loads
        // the module form, and a member's vendor refresh must not turn its CI red
        // over a file nothing has converted yet. The nightly update converts a
        // member's own; this finding names the edit for anyone editing sooner.
        advise('is a task.mjs, the retired module form of a task declaration',
          'convert it to task.json — node <engine>/migrations/task-declarations-to-json.mjs rewrites every task.mjs under the repo\'s packs and deletes the module');
        if (!/export\s+default\s*\{/.test(text)) {
          flag('does not default-export a declaration object', 'convert it to a task.json carrying { id, frequency, preconditions, expected_outcome, … }');
          continue;
        }
      }
      const decl = readDeclarationFields(file, legacy ? stripComments(text) : text);
      if (decl.error) {
        flag(`is not a JSON object: ${decl.error}`, 'write one JSON object: { "id", "frequency", "preconditions", "expected_outcome", … }');
        continue;
      }
      const str = (key) => (typeof decl.scalar(key) === 'string' ? decl.scalar(key) : null);
      const hasNum = (...keys) => keys.some((key) => typeof decl.scalar(key) === 'number');

      const enumField = (key, legal) => {
        const v = str(key);
        if (v === null) flag(`declares no "${key}"`, `add "${key}": one of ${legal.join(', ')}`);
        else if (!legal.includes(v)) flag(`"${key}" is "${v}", not a legal value`, `use one of: ${legal.join(', ')}`);
      };
      enumField('frequency', FREQUENCIES);
      // agent_model is OPTIONAL: absent means no agent (task-defaults.mjs), so the
      // checks below judge the model the task will actually run at.
      const declaredModel = str('agent_model');
      if (decl.has('agent_model') && (declaredModel === null || !MODEL_FAMILIES.includes(declaredModel))) {
        flag(`"agent_model" is ${JSON.stringify(decl.scalar('agent_model') ?? null)}, not a legal value`, `use one of: ${MODEL_FAMILIES.join(', ')} — or drop it: a task with no agent_model runs no agent`);
      }
      const model = declaredModel ?? DEFAULT_AGENT_MODEL;

      // expected_outcome takes the ceiling/policy split, with the retired
      // one-word ceilings an ADVISORY rename like the code-work names below:
      // the runtime normalizes them at the door forever, so a member's vendor
      // refresh must not turn its CI red over a declaration nobody edited.
      const outcome = str('expected_outcome');
      const hasMayAutomerge = decl.has('automerge');
      if (outcome === null) {
        flag('declares no "expected_outcome"', `add "expected_outcome": one of ${OUTCOMES.join(', ')}`);
      } else if (LEGACY_OUTCOMES[outcome] !== undefined) {
        advise(`declares the legacy outcome ceiling "${outcome}"`,
          `write the pair it normalizes to: "expected_outcome": "pr", "automerge": "${LEGACY_OUTCOMES[outcome]}" — and consider a narrower policy than "${LEGACY_OUTCOMES[outcome]}" (a list of diff classes, e.g. ["comment-only-changes"])`);
      } else if (!OUTCOMES.includes(outcome)) {
        flag(`"expected_outcome" is "${outcome}", not a legal value`, `use one of: ${OUTCOMES.join(', ')}`);
      } else if (outcome === 'none' && hasMayAutomerge) {
        flag('a "none" task declares "automerge"', 'drop it — a task that opens no pull request has nothing to merge; or set expected_outcome: "pr"');
      }

      if (str('id') === null) flag('declares no string "id"', 'add "id": the task name (matching its directory)');
      // ADVISORY when absent — a member's converted task carries none, and its
      // vendor refresh must not go red over it — and blocking when declared badly.
      if (!decl.has('description')) {
        advise('declares no "description"', 'add "description": up to fifty words on what the task does or why it exists — not what the other fields already say');
      } else {
        const problem = descriptionProblem(decl.scalar('description'));
        if (problem) flag(problem.what, problem.fix);
      }
      // agent_instructions is required only for an agentic task (agent_model !==
      // 'none') — that's the worker file the agent reads, and it has no default. A
      // `none` task runs no agent, so the field is not applicable.
      if (model !== 'none' && str('agent_instructions') === null) {
        flag('an agentic task (agent_model !== "none") declares no string "agent_instructions"', 'add "agent_instructions": the worker file beside the declaration (e.g. "task.md")');
      }
      // `preconditions` is the only gate a task declares (#1617). Both retired
      // spellings are flagged by NAME rather than merely going unrecognised, so a
      // declaration carrying one is told what replaced it instead of reading as a
      // task that simply forgot its gate.
      if (decl.format === 'mjs' && /\bprecondition\s*[:(]/.test(decl.code.replace(/\bpreconditions\b/g, '').replace(/\bprecondition_signals\b/g, ''))) {
        flag('declares a "precondition" function, which is retired', 'move the gate into "preconditions" — a built-in condition, or a term this task\'s preconditions.mjs exports');
      }
      if (decl.format === 'json' && decl.has('precondition')) {
        flag('declares "precondition", which is retired', 'move the gate into "preconditions" — a built-in condition, or a term this task\'s preconditions.mjs exports');
      }
      if (decl.has('precondition_signals')) {
        flag('declares "precondition_signals", which is retired', 'drop it — the signal union is derived from the conditions, each of which names what it reads');
      }
      // Absent, the task runs always (task-defaults.mjs); declared, the expression
      // is judged term by term.
      if (decl.has('preconditions')) {
        // Deliberately strict: a declaration whose trigger is computed cannot be
        // audited by anyone reading it, which is the whole reason the field is data.
        const expression = decl.list('preconditions');
        if (expression === null) {
          flag('"preconditions" is not a literal list of condition strings', 'write it as a literal, e.g. "preconditions": ["substantive-change"] — a computed expression is unreadable to this check and to the next person');
        } else {
          for (const problem of validatePreconditions(expression, siblingTerms(ctx, file))) flag(problem.what, problem.fix);
        }
      }

      // The code-work/timeout guards (task-code-work DESIGN §2). TWO generations of
      // legacy field names still satisfy the contract — the loader normalizes both —
      // but each earns its own rename finding so the fleet converges on the
      // canonical names.
      const LEGACY_CODE_WORK = [
        { field: 'agent_preprocessing', timeout: 'agent_preprocessing_timeout' },
        { field: 'prework', timeout: 'prework_timeout' },
      ];
      const legacyDeclared = LEGACY_CODE_WORK.filter(({ field }) => str(field) !== null);
      const hasCodeWork = str('code_work') !== null || legacyDeclared.length > 0;
      for (const { field, timeout } of legacyDeclared) {
        // ADVISORY, deliberately, on a blocking rule: the legacy names still
        // satisfy the runtime contract (normalized at load), and a member's
        // vendor refresh must not turn its CI red over files nothing has renamed
        // yet. This finding IS the durable driver of the rename — it names the
        // exact edit and does not age out, which is why neither rename ships a
        // migration note.
        advise(`declares code_work under the legacy name "${field}"`,
          `rename "${field}" → "code_work" and "${timeout}" → "code_work_timeout" (the two phases of task execution are code-work, then agentic-work — neither is named for the other)`);
      }
      // The ordering field's rename. ADVISORY for the same reason as the code-work rename above:
      // the runtime normalizes it at the door, so a member's own task file keeps working and its
      // CI must not go red over a declaration nobody has edited. Worth making because the bare
      // preposition invited reading the field as a time — it is not one; it names task ids, and
      // what it steers is when the item is scheduled onto an executor.
      // The secrets field's rename, advisory for the same reason: the door normalizes
      // it, and only the name changed — the secrets are the code-work phase's.
      if (decl.has('required_secrets')) {
        advise('declares its secrets under the legacy name "required_secrets"',
          'rename "required_secrets" to "code_work_required_secrets" — the secrets are what the code-work phase, the one that runs Action-side, is handed');
      }
      if (decl.has('after')) {
        advise('declares its ordering under the legacy name "after"',
          'rename "after" to "schedule_after" (it names task ids, not a time — what it steers is when this item is scheduled onto an executor)');
      }
      // `session_scope` lost its last reader with the slot scheduler (#974): the
      // queue routes a hand-off by `invocation_endpoint`, and nothing anywhere
      // asks a task what its scope is. ADVISORY, like the code-work rename above and
      // for the same reason — the field still VALIDATES, so a member's vendor
      // refresh must not turn its CI red over a declaration nobody has edited yet;
      // this only keeps the dead field visible until it is dropped.
      if (str('session_scope') !== null) {
        advise('declares "session_scope", which nothing reads',
          'drop it — reach is a property of which endpoint the hand-off calls, so a task needing wider access declares "invocation_endpoint": <a key in the repo\'s taskScheduler.agenticTaskInvocationEndpoints> instead');
      }
      // No default for the bound: a running agent always has one.
      if (model !== 'none' && !hasNum('agent_execution_timeout')) {
        flag('an agentic task (agent_model !== "none") declares no numeric "agent_execution_timeout"', 'add "agent_execution_timeout": seconds bounding the agentic run');
      }
      if (model === 'none' && !hasCodeWork) {
        flag('an agentless task (agent_model: "none") declares no "code_work"', 'add "code_work" (a none task does its work in that subprocess) — or give the task an agent_model');
      }
      if (hasCodeWork) {
        const prep = LEGACY_CODE_WORK.reduce((found, { field }) => found ?? str(field), str('code_work'));
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
