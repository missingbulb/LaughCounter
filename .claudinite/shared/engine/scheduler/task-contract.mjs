// The task declaration contract (per-project-scheduling DESIGN §1) — the single
// source of truth for what a `tasks/<name>/task.mjs` default export must carry.
// Both the author-time `task-declaration-shape` check and the executor-side
// `validate-dispatch` validate against this one function, so the accepted shape
// can never drift between the two surfaces.

import { FREQUENCIES } from './slots.mjs';
import { MODEL_FAMILIES } from './model-map.mjs';

// A declared timeout is always a whole number of seconds, > 0.
const isPositiveInt = (n) => Number.isInteger(n) && n > 0;

// A prework command must stay inside its own task directory — no absolute
// path and no `..` traversal in the command string — the same containment the
// worker-file rule gives agent_instructions (task-prework DESIGN §2).
const escapesTaskDir = (cmd) => /(^|\s)\//.test(cmd) || cmd.includes('..');

// The 2026-08-06 phase-language rename (owner): task execution is two similar,
// consecutive phases — deterministic PREWORK, then AGENTIC WORK — and the field
// names say so instead of framing the code phase as preparation for the agent.
// Legacy names stay accepted here (consumer local packs rename on their own
// clock, driven by a migration note), canonical names win when both are present.
const LEGACY_FIELDS = { agent_preprocessing: 'prework', agent_preprocessing_timeout: 'prework_timeout' };

// Return the declaration with canonical field names. Non-objects pass through
// untouched so validateTaskDeclaration still reports them. Loaders (discover,
// resolve-dispatch) normalize once; everything downstream sees only `prework`.
export function normalizeTaskDeclaration(decl) {
  if (decl === null || typeof decl !== 'object' || Array.isArray(decl)) return decl;
  const out = { ...decl };
  for (const [legacy, canonical] of Object.entries(LEGACY_FIELDS)) {
    if (out[legacy] !== undefined) {
      if (out[canonical] === undefined) out[canonical] = out[legacy];
      delete out[legacy];
    }
  }
  return out;
}

// The write ceiling a task declares (DESIGN §1, §4). A declared MAXIMUM, not a
// promise: `none` may never open a PR, `open-pr` may open but never merge,
// `merged-pr` may arm auto-merge. "No change" is always legal.
export const OUTCOMES = ['none', 'open-pr', 'merged-pr'];


// The executor-session dispatch vocabulary — DEPRECATED as a declared field, kept
// as routing. 'self' dispatches ride `ready-for-agent`; 'fleet' rides
// `ready-for-agent-fleet`, the label whose executor session holds the owner's repos.
// A task no longer declares this: a repo's executor carries the access it was
// provisioned with (the sheepdog enforcer's already spans the fleet), so the split
// protects nothing there. The one standing use is the canon home's curation tasks
// (growth-promote, growth-discover-packs), whose fleet executor is a separate,
// broader-scoped routine in that one repo.
export const SESSION_SCOPES = ['self', 'fleet'];

// The signal-collector vocabulary (DESIGN §3.3). A task collects only the union
// of what its due tasks declare. `fleet` is canon-only (consumers cannot declare
// it) — that restriction is enforced where signals are collected, not here; the
// shape check only asserts a declared name is a real collector.
export const SIGNAL_NAMES = [
  'commits', 'prs', 'issues', 'branches', 'release',
  'localPacks', 'sharedMount', 'conversationLogs', 'stamp', 'fleet',
];

// Validate one task declaration. Returns an array of `{ what, fix }` problems —
// empty means the declaration is well-formed. Pure: no I/O, no imports of the
// task itself; the caller supplies the already-loaded default export.
export function validateTaskDeclaration(raw) {
  const decl = normalizeTaskDeclaration(raw);
  if (decl === null || typeof decl !== 'object' || Array.isArray(decl)) {
    return [{ what: 'task.mjs does not default-export a declaration object', fix: 'export default { id, frequency, precondition_signals, agent_model, expected_outcome, agent_instructions, precondition }' }];
  }
  const problems = [];
  const bad = (what, fix) => problems.push({ what, fix });

  if (typeof decl.id !== 'string' || decl.id.trim() === '') {
    bad('the task has no string "id"', 'give the task an "id" matching its directory name');
  }
  if (!FREQUENCIES.includes(decl.frequency)) {
    bad(`"frequency" ${JSON.stringify(decl.frequency)} is not a legal frequency`, `set one of: ${FREQUENCIES.join(', ')}`);
  }
  if (!Array.isArray(decl.precondition_signals) || !decl.precondition_signals.every((s) => SIGNAL_NAMES.includes(s))) {
    bad(`"precondition_signals" must be an array of known signal names`, `use only: ${SIGNAL_NAMES.join(', ')}`);
  }
  if (!MODEL_FAMILIES.includes(decl.agent_model)) {
    bad(`"agent_model" ${JSON.stringify(decl.agent_model)} is not a legal model family`, `set one of: ${MODEL_FAMILIES.join(', ')}`);
  }
  if (!OUTCOMES.includes(decl.expected_outcome)) {
    bad(`"expected_outcome" ${JSON.stringify(decl.expected_outcome)} is not a legal outcome ceiling`, `set one of: ${OUTCOMES.join(', ')}`);
  }
  // agent_instructions — REQUIRED for an agentic task (agent_model !== 'none'):
  // that's the worker file the agent reads. A `none` task runs no agent, so the
  // field is not applicable and is neither required nor validated when present.
  if (decl.agent_model !== 'none' && (typeof decl.agent_instructions !== 'string' || decl.agent_instructions.trim() === '')) {
    bad('an agentic task (agent_model !== "none") declares no string "agent_instructions"', 'point "agent_instructions" at the worker file beside task.mjs (e.g. "task.md")');
  }
  if (typeof decl.precondition !== 'function') {
    bad('"precondition" is not a function', 'export a precondition(signals, config) that returns { run, reason, context? }');
  }

  /**
   * session_scope — OPTIONAL; still honoured while it lingers (the canon's
   * curation tasks are the one standing use — each pacifies the warning with a
   * comment at its declaration site). It stays VALIDATED rather than ignored: a
   * deprecated field that silently accepts a typo mis-routes the dispatch to an
   * executor that declines it, and the task then never runs while the scheduler
   * re-arms it hourly.
   * @deprecated An executor's reach is how its repo is provisioned, never
   *   something a task asks for — drop the field; dispatches ride ready-for-agent.
   */
  if (decl.session_scope !== undefined && !SESSION_SCOPES.includes(decl.session_scope)) {
    bad(`"session_scope" ${JSON.stringify(decl.session_scope)} is not a legal session scope`, `drop it (dispatches ride ready-for-agent by default) — or, while it lingers, set one of: ${SESSION_SCOPES.join(', ')}`);
  }

  // Prework (task-prework DESIGN §2) — OPTIONAL. The deterministic first phase
  // of task execution, a command the scheduler runs as a subprocess. When present
  // it must be a non-empty, task-local command AND carry a positive-integer
  // prework_timeout — the hard kill that bounds the subprocess.
  if (decl.prework !== undefined) {
    if (typeof decl.prework !== 'string' || decl.prework.trim() === '') {
      bad('"prework" is present but not a non-empty string', 'set it to a command whose executable is a script beside task.mjs, e.g. "node prepare.mjs"');
    } else if (escapesTaskDir(decl.prework)) {
      bad('"prework" reaches outside the task directory (absolute path or "..")', 'reference a sibling script only, e.g. "node prepare.mjs"');
    }
    if (!isPositiveInt(decl.prework_timeout)) {
      bad('"prework" is set but "prework_timeout" is not a positive integer', 'add "prework_timeout": the seconds after which the subprocess is killed and the task fails');
    }
  }

  // The repo Actions secrets this task needs configured (DESIGN §9). Purely
  // DECLARATIVE — like a pack's adoption `questions`, its job is to drive the ask
  // (adoption interactively, the scheduler by owner issue), not to gate anything
  // here. So the only shape asserted is "a list of names"; whether the repo has
  // actually configured them is a fact about the repo, answered where the secrets
  // bundle is readable, never at author time.
  if (decl.required_secrets !== undefined
      && !(Array.isArray(decl.required_secrets) && decl.required_secrets.every((s) => typeof s === 'string' && s.trim() !== ''))) {
    bad('"required_secrets" is not an array of secret names', 'list the repo Actions secret names this task needs, e.g. ["SOME_API_KEY"]');
  }

  // Execution bound (task-prework DESIGN §2, §6) — an agentic task MUST
  // declare a positive-integer agent_execution_timeout. There is always a bound
  // on an agentic run; enforcement is best-effort (the executor surfaces the
  // value to the subagent). A `none` task runs no agent, so it needs none.
  if (MODEL_FAMILIES.includes(decl.agent_model) && decl.agent_model !== 'none' && !isPositiveInt(decl.agent_execution_timeout)) {
    bad('an agentic task (agent_model !== "none") declares no positive-integer "agent_execution_timeout"', 'add "agent_execution_timeout": the seconds bounding the agentic run — generous; extreme protection, not a scheduling knob');
  }

  // An agentless task (agent_model: none) runs no agent, so its ONLY work is
  // prework — a `none` task with no prework does nothing (DESIGN §4, retiring
  // the in-process inline path). Require the command.
  if (decl.agent_model === 'none' && decl.prework === undefined) {
    bad('an agentless task (agent_model: "none") declares no "prework"', 'add "prework" (a none task does its work in that subprocess) — or give the task an agent_model');
  }

  return problems;
}
