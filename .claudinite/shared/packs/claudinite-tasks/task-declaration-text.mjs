// The task declaration as a file and as text — the half every reader can load,
// the dashboard's browser bundle included: no Node built-ins here. The fs half
// (finding and loading a folder's declaration) is task-declaration.mjs, which
// re-exports this.
//
// `task.json` is the declaration: plain data, pointing at `task.schema.json`
// through `$schema`, and readable by anything that can parse JSON. It is the
// only declaration file a task folder may carry.

export const TASK_DECLARATION_FILE = 'task.json';

// The file-listing form of the same fact, for the checks and the dashboard, which
// select a task folder out of a path list rather than probing a directory. Group 1
// is the task's directory name.
export const TASK_DECLARATION_PATH_RE = /(^|\/)tasks\/([^/]+)\/task\.json$/;
export const isTaskDeclarationPath = (path) => TASK_DECLARATION_PATH_RE.test(path);

// A `task.json`'s text as the declaration object. `$schema` is the editor's
// pointer, not a field of the contract, and leaves here.
export function parseTaskDeclaration(text) {
  const decl = JSON.parse(text);
  if (decl !== null && typeof decl === 'object' && !Array.isArray(decl)) delete decl.$schema;
  return decl;
}

// The order a declaration's keys are written in, grouped by what they say: what
// the task is, when it runs, what it may write, then the two phases — code work,
// then the agent. A key not listed keeps its place after the listed ones.
export const KEY_ORDER = [
  '$schema', 'id', 'description',
  'schedule_after', 'trigger', 'preconditions',
  'expected_outcome', 'automerge', 'on_interrupt', 'invocation_endpoint',
  'code_work', 'code_work_timeout', 'code_work_required_secrets',
  'agent_model', 'model_from_request', 'agent_instructions', 'agent_execution_timeout',
];
export function orderTaskKeys(decl) {
  const rank = (k) => { const i = KEY_ORDER.indexOf(k); return i === -1 ? KEY_ORDER.length : i; };
  return Object.fromEntries(Object.entries(decl).sort(([a], [b]) => rank(a) - rank(b)));
}

// --- reading a declaration as TEXT --------------------------------------------
//
// The author-time checks run over a file listing, not a module graph, and the
// dashboard renders other repos over the API where there is nothing to import.
// Both read the declaration's scalar fields out of its text — a `task.json`
// parsed whole.
//
// The uniform view: `has(key)` (the field is declared at all, whatever its
// value), `scalar(key)` (a string, number or boolean, else undefined),
// `list(key)` (a list of strings; null when declared but unreadable). `error`
// carries a JSON parse failure, in which case every reader answers "absent" and
// the caller reports the error. `code` is the raw text, for the callers that
// still pattern-match one thing (a sibling `preconditions.mjs`, say).
export function readDeclarationFields(code) {
  let obj = null;
  let error = null;
  try {
    obj = JSON.parse(code);
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) { error = 'not a JSON object'; obj = null; }
  } catch (e) {
    error = e.message;
  }
  const value = (key) => (obj && key !== '$schema' ? obj[key] : undefined);
  return {
    format: 'json',
    error,
    object: obj,
    code,
    has: (key) => value(key) !== undefined,
    scalar: (key) => (['string', 'number', 'boolean'].includes(typeof value(key)) ? value(key) : undefined),
    list: (key) => {
      const v = value(key);
      if (v === undefined) return undefined;
      return Array.isArray(v) && v.every((s) => typeof s === 'string') ? v : null;
    },
  };
}
