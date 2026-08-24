// The task declaration contract (per-project-scheduling DESIGN §1) — the single
// source of truth for what a `tasks/<name>/task.mjs` default export must carry.
// Both the author-time `task-declaration-shape` check and the executor-side
// `validate-dispatch` validate against this one function, so the accepted shape
// can never drift between the two surfaces.

import { ACCEPTED_FREQUENCIES, normalizeFrequency } from './calendar.mjs';
import { MODEL_FAMILIES } from './model-map.mjs';
import { EXECUTING_LEASH_MS } from './queue/leases.mjs';

// A declared timeout is always a whole number of seconds, > 0.
const isPositiveInt = (n) => Number.isInteger(n) && n > 0;

// A code-work command must stay inside its own task directory — no absolute
// path and no `..` traversal in the command string — the same containment the
// worker-file rule gives agent_instructions (task-code-work DESIGN §2).
const escapesTaskDir = (cmd) => /(^|\s)\//.test(cmd) || cmd.includes('..');

// Task execution is two similar, consecutive phases — deterministic CODE-WORK,
// then AGENTIC WORK — and the field names say so. Neither phase is named for
// the other: the code phase is not preparation for the agent, it is the first
// of two peers, and a task may declare only it.
//
// Two renames have reached these fields (2026-08-06 agent_preprocessing →
// prework, 2026-08-18 prework → code-work); both legacy spellings stay accepted
// here, since a consumer's own local packs rename on their own clock. Every
// legacy key maps straight to today's canonical name rather than to its
// immediate successor, so a declaration written for the oldest vocabulary
// normalizes in one pass. Canonical names win when both are present.
const LEGACY_FIELDS = {
  agent_preprocessing: 'code_work',
  agent_preprocessing_timeout: 'code_work_timeout',
  prework: 'code_work',
  prework_timeout: 'code_work_timeout',
  after: 'schedule_after',
};

// Return the declaration with canonical field names. Non-objects pass through
// untouched so validateTaskDeclaration still reports them. Loaders (discover,
// resolve-dispatch) normalize once; everything downstream sees only `code_work`.
export function normalizeTaskDeclaration(decl) {
  if (decl === null || typeof decl !== 'object' || Array.isArray(decl)) return decl;
  const out = { ...decl };
  for (const [legacy, canonical] of Object.entries(LEGACY_FIELDS)) {
    if (out[legacy] !== undefined) {
      if (out[canonical] === undefined) out[canonical] = out[legacy];
      delete out[legacy];
    }
  }
  // THE ONE DOOR for the retired frequency spellings (DESIGN §17.1). Here rather than in the
  // calendar because a frequency is read by more than the calendar — see `normalizeFrequency`.
  if (out.frequency !== undefined) out.frequency = normalizeFrequency(out.frequency);
  return out;
}

// The write ceiling a task declares (DESIGN §1, §4). A declared MAXIMUM, not a
// promise: `none` may never open a PR, `open-pr` may open but never merge,
// `merged-pr` may arm auto-merge. "No change" is always legal.
export const OUTCOMES = ['none', 'open-pr', 'merged-pr'];


// The retired scope vocabulary. It routed a slot dispatch to one of two labels, and
// its last reader went with the slot scheduler (#974): reach is now a property of
// which endpoint the hand-off calls (`invocation_endpoint`), so nothing anywhere
// asks a task what its scope is.
//
// The values stay so a declaration still carrying the field VALIDATES rather than
// failing — nothing converges a member's task files, so a member cannot be moved
// off it by a release; `task-declaration-shape` raises it as an advisory rename
// instead, and the field is dropped as each declaration is next edited.
// @deprecated Declares nothing. Name an `invocation_endpoint` if the task needed
//   reach an ordinary session in its repo does not have.
export const SESSION_SCOPES = ['self', 'fleet'];

// What must happen to a task's work item when a recovery path would re-execute it
// (tasks-dispatch DESIGN §6). `requeue` is the safe-side default for sweep-shaped
// work; `needs-human` is the at-most-once dial a one-shot side effect declares.
export const INTERRUPT_POLICIES = ['requeue', 'needs-human'];


// The signal-collector vocabulary (DESIGN §3.3). A task collects only the union
// of what its due tasks declare. `fleet` is canon-only (consumers cannot declare
// it) — that restriction is enforced where signals are collected, not here; the
// shape check only asserts a declared name is a real collector.
export const SIGNAL_NAMES = [
  'commits', 'prs', 'issues', 'branches', 'release',
  'localPacks', 'sharedMount', 'conversationLogs', 'stamp', 'fleet', 'request',
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
  // ACCEPTED, not FREQUENCIES: a member's own task file may still carry a retired spelling and
  // must keep running, since nothing converges a member's task files. Stopping a NEW declaration
  // from naming one is the author-time declaration-shape check's job, not this one's — the split
  // is deliberate, and `FREQUENCIES` beside `ACCEPTED_FREQUENCIES` in calendar.mjs is where it is
  // spelled out.
  if (!ACCEPTED_FREQUENCIES.includes(decl.frequency)) {
    bad(`"frequency" ${JSON.stringify(decl.frequency)} is not a legal frequency`, `set one of: ${ACCEPTED_FREQUENCIES.join(', ')}`);
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
  // precondition(signals, config, item). The third argument is THIS occurrence's own
  // facts — its `Request`, its `Model`, its `Not-before` — for a verdict that is
  // about one target rather than about the repo: a request item's verdict is about
  // the issue it names, which no signal bundle can single out. Backwards compatible
  // by construction, since a precondition simply does not declare an argument it
  // does not read.
  //
  // Three answers, not two: `{ run: true }`, `{ run: false, reason }`, and
  // `{ error }` — the precondition COULD NOT ANSWER. The third is a run failure
  // rather than a verdict (F27): a decline is a decision about the world, and one
  // taken on an API that would not answer is a guess whose write-backs cannot land.
  if (typeof decl.precondition !== 'function') {
    bad('"precondition" is not a function', 'export a precondition(signals, config, item) that returns { run, reason, context? } — or { error } when it could not answer');
  }

  /**
   * model_from_request — OPTIONAL, and reserved to the engine's own built-in task.
   * A task that declares it runs at the model the ITEM names (`Model:`, written by
   * the scheduler run from a write-gated label), falling back to `agent_model` when the item
   * names none. It is the only field that lets anything on an item define behaviour,
   * so it is fenced rather than waved through (DESIGN §16.7): the shape check accepts
   * only `true`, and discovery gives pack tasks no way to be the built-in one.
   */
  if (decl.model_from_request !== undefined && decl.model_from_request !== true) {
    bad(`"model_from_request" ${JSON.stringify(decl.model_from_request)} is not \`true\``,
      'drop the field — only the engine\'s built-in request task reads a model off its item, and every other task names its own agent_model');
  }

  /**
   * session_scope — OPTIONAL, and READ BY NOTHING. Kept validated rather than
   * rejected outright so a lingering declaration still loads: nothing carries a
   * task-file change across the fleet, so a member cannot be migrated off the field
   * by a release, and rejecting it would stop that member's task running over a word
   * that no longer does anything.
   * @deprecated Declares nothing since #974. Drop it; if the task needed reach an
   *   ordinary session in its repo does not have, name an `invocation_endpoint`.
   */
  if (decl.session_scope !== undefined && !SESSION_SCOPES.includes(decl.session_scope)) {
    bad(`"session_scope" ${JSON.stringify(decl.session_scope)} is not a legal session scope`, `drop it — the field is read by nothing; name an "invocation_endpoint" if the task needs wider reach`);
  }

  // Code-work (task-code-work DESIGN §2) — OPTIONAL. The deterministic first phase
  // of task execution, a command the scheduler runs as a subprocess. When present
  // it must be a non-empty, task-local command AND carry a positive-integer
  // code_work_timeout — the hard kill that bounds the subprocess.
  if (decl.code_work !== undefined) {
    if (typeof decl.code_work !== 'string' || decl.code_work.trim() === '') {
      bad('"code_work" is present but not a non-empty string', 'set it to a command whose executable is a script beside task.mjs, e.g. "node prepare.mjs"');
    } else if (escapesTaskDir(decl.code_work)) {
      bad('"code_work" reaches outside the task directory (absolute path or "..")', 'reference a sibling script only, e.g. "node prepare.mjs"');
    }
    if (!isPositiveInt(decl.code_work_timeout)) {
      bad('"code_work" is set but "code_work_timeout" is not a positive integer', 'add "code_work_timeout": the seconds after which the subprocess is killed and the task fails');
    } else if (decl.code_work_timeout * 1000 >= EXECUTING_LEASH_MS) {
      // F17: a code-work legally allowed to outlive the executing leash is reclaimed
      // WHILE ALIVE, and the failure is not one duplicate run but a livelock —
      // every tenure reclaimed before it can finish, code-work re-executing each
      // cycle, the occurrence never converging. The leash is the engine's, so the
      // comparison is made where a declaration is judged.
      bad(`"code_work_timeout" (${decl.code_work_timeout}s) reaches the executor's ${EXECUTING_LEASH_MS / 60e3}-minute claim leash`,
        `bound code_work under ${EXECUTING_LEASH_MS / 60e3} minutes — a code_work that can outlive the leash is reclaimed while still running, and the item livelocks`);
    }
  }

  // --- the work-item queue's three optional declarations (tasks-dispatch DESIGN) ---

  // `schedule_after` — ordering, declared (DESIGN §9). A list of `<pack>/<task>` ids this
  // task yields to WHILE THEY ARE LIVE THIS CYCLE. It compiles to the executor's
  // pick-time yield, never to a `Blocked-by` edge: a standing item that rolls
  // never closes, so blocked-by would starve every dependent of a quiet upstream
  // forever. The engine never learns what any named task does — it reads item
  // states, generically.
  if (decl.schedule_after !== undefined
      && !(Array.isArray(decl.schedule_after)
        && decl.schedule_after.every((s) => typeof s === 'string' && /^[^/\s]+\/[^/\s]+$/.test(s)))) {
    bad('"schedule_after" is not an array of "<pack>/<task>" ids', 'e.g. "schedule_after": ["claudinite-lifecycle/update"] — this task is not scheduled onto an executor while those are live this cycle');
  }

  // `on_interrupt` — the ack-early/ack-late dial (DESIGN §6). Most of this fleet's
  // tasks are sweep-shaped and converge safely on a re-run, so the default is
  // `requeue`. A genuinely one-shot side effect (a store submission, an external
  // notification) declares `needs-human`, and every recovery path that would
  // re-execute it — the leash reclaim, the hand-off retry — converges to triage
  // instead: at-most-once plus a human.
  if (decl.on_interrupt !== undefined && !INTERRUPT_POLICIES.includes(decl.on_interrupt)) {
    bad(`"on_interrupt" ${JSON.stringify(decl.on_interrupt)} is not a legal policy`, `set one of: ${INTERRUPT_POLICIES.join(', ')} (default "requeue")`);
  }

  // `invocation_endpoint` — a NAME, never a URL (DESIGN §12). The repo's config
  // maps the name to the URL and to the name of the Actions secret holding its
  // token, so no vendored pack file carries deployment detail or anything adjacent
  // to a credential. This is also what replaces session_scope: reach is a property
  // of which endpoint a task names.
  if (decl.invocation_endpoint !== undefined
      && !(typeof decl.invocation_endpoint === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(decl.invocation_endpoint))) {
    bad('"invocation_endpoint" is not a kebab-case endpoint name', 'name a key from the repo\'s taskScheduler.agenticTaskInvocationEndpoints map, e.g. "fleet" — never a URL');
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

  // Execution bound (task-code-work DESIGN §2, §6) — an agentic task MUST
  // declare a positive-integer agent_execution_timeout. There is always a bound
  // on an agentic run; enforcement is best-effort (the executor surfaces the
  // value to the subagent). A `none` task runs no agent, so it needs none.
  if (MODEL_FAMILIES.includes(decl.agent_model) && decl.agent_model !== 'none' && !isPositiveInt(decl.agent_execution_timeout)) {
    bad('an agentic task (agent_model !== "none") declares no positive-integer "agent_execution_timeout"', 'add "agent_execution_timeout": the seconds bounding the agentic run — generous; extreme protection, not a scheduling knob');
  }

  // An agentless task (agent_model: none) runs no agent, so its ONLY work is
  // code-work — a `none` task with no code-work does nothing (DESIGN §4, retiring
  // the in-process inline path). Require the command.
  if (decl.agent_model === 'none' && decl.code_work === undefined) {
    bad('an agentless task (agent_model: "none") declares no "code_work"', 'add "code_work" (a none task does its work in that subprocess) — or give the task an agent_model');
  }

  return problems;
}
