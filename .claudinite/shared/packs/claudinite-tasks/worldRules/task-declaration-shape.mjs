import { finding } from '../../../engine/checks/helpers/findings.mjs';
import { stripComments } from '../../../engine/checks/helpers/code-scanning.mjs';
import { ACCEPTED_FREQUENCIES, cadenceTermFor, cadenceOf } from '../../claudinite-tasks/calendar.mjs';
import { MODEL_FAMILIES } from '../../claudinite-tasks/model-map.mjs';
import {
  OUTCOMES, LEGACY_OUTCOMES, LEGACY_CEILINGS, OUTCOME_NO_PR, DEFAULT_AGENT_MODEL, descriptionProblem, normalizeTaskDeclaration,
  TRIGGERS, TRIGGER_SCHEDULE, TRIGGER_REQUEST,
} from '../../claudinite-tasks/task-contract.mjs';
import { validatePreconditions, termsMap, preconditionNeedsItem } from '../../claudinite-tasks/precondition-policy.mjs';
import { TASK_DECLARATION_PATH_RE, readDeclarationFields } from '../../claudinite-tasks/task-declaration-text.mjs';

// Every scheduler task is a `tasks/<name>/task.json` carrying the declaration
// contract (per-project-scheduling DESIGN §1) with legal enum values. This
// asserts that shape statically at author time — the executor and scheduler
// validate the same contract at run time (task-contract.mjs), so an illegal
// condition/model/outcome, or a missing field, is caught here first.
//
// RELEVANCE FIRST (engine/checks/README.md): gated on a task declaration file
// existing, so the check is inert on any repo without tasks. Static text over the
// self-contained file — a `task.json` parsed whole — keyed off the canonical enum
// lists so the legal values never drift from the runtime validator.

// The term names the task's own `preconditions.mjs` exports, read as text: the
// check runs over a file listing, not a module graph, so it recognises a
// task-local condition by the key that defines it. A term the file computes
// rather than spells is not found, and its declaration reads as unknown — which
// is the same "write it so a reader can see it" the literal rule above states.
// Read as TEXT, never imported: a check must not execute a member's own module. So
// each term is its name plus the one property of it a declaration can be wrong
// about — `needsItem`, which decides whether the term can be judged at a tick at
// all. Either quote style, because a member's file is its author's.
const TERM_NAME = /^ {2}['"]([^'"]+)['"]:/gm;
function siblingTerms(ctx, taskFile) {
  const text = ctx.read(taskFile.replace(/task\.json$/, 'preconditions.mjs'));
  if (text === null) return new Map();
  const body = stripComments(text);
  const start = body.indexOf('export const terms');
  if (start === -1) return new Map();
  const section = body.slice(start);
  const named = [...section.matchAll(TERM_NAME)];
  return termsMap(Object.fromEntries(named.map((m, i) => {
    const block = section.slice(m.index, named[i + 1]?.index ?? section.length);
    return [m[1], { signals: [], needsItem: /\bneedsItem\s*:\s*true\b/.test(block) }];
  })));
}

const rule = {
  id: 'task-declaration-shape',
  severity: 'blocking',
  description: 'A tasks/<name>/task.json carries the task contract (id, description, preconditions, expected_outcome) with legal enum values and a well-formed precondition expression stating when the task runs; an agentic task names its worker file and bounds its run, and any code_work carries a timeout and stays task-local',
  doc: 'packs/claudinite-tasks/README.md',
  why: 'the scheduler run and executor read agent_model/expected_outcome/preconditions from this file, not the work item — an illegal or missing value means a task never fires, fires wrong, or writes past its ceiling',

  run(ctx) {
    const out = [];
    for (const file of ctx.files.filter((f) => TASK_DECLARATION_PATH_RE.test(f))) {
      const text = ctx.read(file);
      if (text === null) continue;
      const flag = (what, fix) => out.push(finding(rule, { file, what, fix }));
      const advise = (what, fix) => out.push(finding(rule, { file, severity: 'advisory', what, fix }));

      const decl = readDeclarationFields(text);
      if (decl.error) {
        flag(`is not a JSON object: ${decl.error}`, 'write one JSON object: { "id", "description", "preconditions", "expected_outcome", … }');
        continue;
      }
      const str = (key) => (typeof decl.scalar(key) === 'string' ? decl.scalar(key) : null);
      const hasNum = (...keys) => keys.some((key) => typeof decl.scalar(key) === 'number');

      const enumField = (key, legal) => {
        const v = str(key);
        if (v === null) flag(`declares no "${key}"`, `add "${key}": one of ${legal.join(', ')}`);
        else if (!legal.includes(v)) flag(`"${key}" is "${v}", not a legal value`, `use one of: ${legal.join(', ')}`);
      };
      // `frequency` is retired (tasks-dispatch DESIGN §5): the cadence is a condition
      // in `preconditions`, and the door reads the field as exactly that term. ADVISORY
      // for the same reason as every rename below — the file keeps working, and the
      // nightly update rewrites a member's own — so what blocks is only a declaration
      // that states no "when" at all.
      const legacyFrequency = str('frequency');
      if (decl.has('frequency')) {
        const term = ACCEPTED_FREQUENCIES.includes(legacyFrequency) ? cadenceTermFor(legacyFrequency) : 'due:<daily|weekly|monthly>';
        advise('declares the retired field "frequency"', term === null
          ? 'drop the field, and a "none" beside it: "manual" meant no schedule, which a declaration says by stating no "preconditions" at all'
          : `write it as the first condition — "preconditions": [${JSON.stringify(term)}, …] — and drop a "none" beside it; the field reads as exactly that today`);
      }
      // `trigger` says whether the scheduler asks this task at every tick, and is
      // OPTIONAL for one convergence window (#1789) — absent, the door reads it off
      // the shape of the conditions, and `legacy-task-fields` is what says so. What
      // is checked here is a STATED one: the value, and the one pairing that cannot
      // work. A `schedule` task whose expression reads the ITEM has nothing to be
      // judged against at a tick — the scheduler's own ask carries no item — so the
      // term errors on every tick and the task's lane fills with failed runs rather
      // than ever declining.
      if (decl.has('trigger')) {
        const trigger = str('trigger');
        if (trigger === null || !TRIGGERS.includes(trigger)) {
          flag(`"trigger" is ${JSON.stringify(decl.scalar('trigger') ?? null)}, not a legal value`,
            `use one of: ${TRIGGERS.join(', ')} — "${TRIGGER_SCHEDULE}" is asked by the scheduler at every tick, "${TRIGGER_REQUEST}" runs only from an item somebody creates`);
        } else if (trigger === TRIGGER_SCHEDULE && decl.list('preconditions')
          && preconditionNeedsItem(decl.list('preconditions'), siblingTerms(ctx, file))) {
          flag('a "schedule" task states a condition that reads the item itself',
            `write "trigger": "${TRIGGER_REQUEST}" — a condition about one item can only be judged once an item exists, and the scheduler's ask at a tick has none, so this task would fail every tick instead of declining`);
        } else if (trigger === TRIGGER_REQUEST && cadenceOf(decl.list('preconditions'))) {
          // Inert, not merely redundant, which is why this blocks: nothing asks a
          // request task, so every occurrence of it is an item somebody created,
          // every such item carries `Woken:`, and a wake stands in for the cadence.
          // The term cannot decline a single run, and reads as though it could.
          flag('a "request" task states a cadence term',
            'drop the term — nothing asks this task, so every item of it is one somebody created and carries `Woken:`, which satisfies a cadence; the term can never decline a run, it only reads as though it limits the lever');
        }
      }

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
          `write the pair it normalizes to: "expected_outcome": "fresh_pr", "automerge": "${LEGACY_OUTCOMES[outcome]}" — and consider a narrower policy than "${LEGACY_OUTCOMES[outcome]}" (a list of diff classes, e.g. ["comment-only-changes"])`);
      } else if (LEGACY_CEILINGS[outcome] !== undefined) {
        advise(`declares the legacy outcome ceiling "${outcome}"`,
          `write the word it became: "expected_outcome": "${LEGACY_CEILINGS[outcome]}" — the same behaviour, in the vocabulary that also offers amend_existing_or_create_new_pr and supersede_existing_pr`);
      } else if (!OUTCOMES.includes(outcome)) {
        flag(`"expected_outcome" is "${outcome}", not a legal value`, `use one of: ${OUTCOMES.join(', ')}`);
      }
      // Judged on the word the door normalizes to, so the retired `none` gets the
      // same verdict as today's spelling beside its rename advisory.
      if (outcome !== null && (LEGACY_CEILINGS[outcome] ?? outcome) === OUTCOME_NO_PR && hasMayAutomerge) {
        flag(`a "${OUTCOME_NO_PR}" task declares "automerge"`, 'drop it — a task that opens no pull request has nothing to merge; or set expected_outcome: "fresh_pr"');
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
      // `preconditions` is the only gate a task declares (#1617). The retired
      // spelling is flagged by NAME rather than merely going unrecognised, so a
      // declaration carrying it is told what replaced it instead of reading as a
      // task that simply forgot its gate.
      if (decl.has('precondition')) {
        flag('declares "precondition", which is retired', 'move the gate into "preconditions" — a built-in condition, or a term this task\'s preconditions.mjs exports');
      }
      if (decl.has('precondition_signals')) {
        flag('declares "precondition_signals", which is retired', 'drop it — the signal union is derived from the conditions, each of which names what it reads');
      }
      // What must hold for a run, and OPTIONAL: a declaration stating none requires
      // nothing, and every occurrence of it runs. A retired `frequency` reads exactly
      // as the door reads it, cadence term first and a `none` beside it dropped — and
      // the expression is judged term by term.
      if (decl.has('preconditions') || decl.has('frequency')) {
        // Deliberately strict: a declaration whose trigger is computed cannot be
        // audited by anyone reading it, which is the whole reason the field is data.
        const stated = decl.has('preconditions') ? decl.list('preconditions') : [];
        if (stated === null) {
          flag('"preconditions" is not a literal list of condition strings', 'write it as a literal, e.g. "preconditions": ["due:daily", "substantive-change"] — a computed expression is unreadable to this check and to the next person');
        } else {
          const expression = normalizeTaskDeclaration({ preconditions: stated, ...(decl.has('frequency') ? { frequency: legacyFrequency } : {}) }).preconditions;
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
