// The task declaration as a file and as text — the half every reader can load,
// the dashboard's browser bundle included: no Node built-ins here. The fs half
// (finding and loading a folder's declaration) is task-declaration.mjs, which
// re-exports this.
//
// `task.json` is the declaration: plain data, pointing at `task.schema.json`
// through `$schema`, and readable by anything that can parse JSON. `task.mjs` (a
// default-exported object literal) is the retired module form, still accepted at
// the door so a member's own local-pack tasks keep running until its nightly
// update converts them (the `task-declarations-json` record).

// Canonical first: when a folder carries both, the JSON is the declaration and
// the module is a leftover the converter did not get to delete.
export const TASK_DECLARATION_FILE = 'task.json';
// @legacy-tolerance advisory:legacy-task-fields retire:#1642
export const LEGACY_TASK_DECLARATION_FILE = 'task.mjs';
export const TASK_DECLARATION_FILES = [TASK_DECLARATION_FILE, LEGACY_TASK_DECLARATION_FILE];

// The file-listing form of the same fact, for the checks and the dashboard, which
// select a task folder out of a path list rather than probing a directory. Group 1
// is the task's directory name, group 2 the declaration file's extension.
export const TASK_DECLARATION_PATH_RE = /(^|\/)tasks\/([^/]+)\/task\.(json|mjs)$/;
export const isTaskDeclarationPath = (path) => TASK_DECLARATION_PATH_RE.test(path);
// @legacy-tolerance advisory:legacy-task-fields retire:#1642
export const isLegacyTaskDeclarationPath = (path) => path.endsWith(`/${LEGACY_TASK_DECLARATION_FILE}`) && isTaskDeclarationPath(path);

// The file name of a path, without a path module.
const baseName = (path) => path.slice(path.lastIndexOf('/') + 1);

// A `task.json`'s text as the declaration object. `$schema` is the editor's
// pointer, not a field of the contract, and leaves here.
export function parseTaskDeclaration(text) {
  const decl = JSON.parse(text);
  if (decl !== null && typeof decl === 'object' && !Array.isArray(decl)) delete decl.$schema;
  return decl;
}

// --- reading a declaration as TEXT --------------------------------------------
//
// The author-time checks run over a file listing, not a module graph, and the
// dashboard renders other repos over the API where there is nothing to import.
// Both read the declaration's scalar fields out of its text. A `task.json` is
// parsed whole; a `task.mjs` is lifted by pattern over comment-stripped source
// (the caller strips — this module stays free of the engine's helpers so the
// dashboard can bundle it). A field the module form computes rather than spells
// reads as absent, which is what the checks want: a declaration nobody can read
// by eye is the reason the field is data.
//
// The key must open the line or follow a `{` / `,` — anchoring on nothing would
// let `code_work` be found inside `agent_code_work`. The value may close on a
// comma, the object's brace, or the line's end, so a last field without a
// trailing comma still reads.
const at = (field) => `(?:^|[{,])\\s*${field}:\\s*`;

const mjsScalar = (src, field) => {
  const m = new RegExp(`${at(field)}(?:'([^']*)'|"([^"]*)"|(\\d+(?:\\.\\d+)?)|(true|false))\\s*(?=[,}\\n]|$)`, 'm').exec(src);
  if (!m) return undefined;
  if (m[3] !== undefined) return Number(m[3]);
  if (m[4] !== undefined) return m[4] === 'true';
  return m[1] ?? m[2];
};

// A literal list of strings, `null` when the field is present but not one a
// reader can see through (a computed expression), `undefined` when absent.
const mjsStringList = (src, field) => {
  const present = new RegExp(`${at(field)}`, 'm').exec(src);
  if (!present) return undefined;
  const m = new RegExp(`${at(field)}\\[([^\\]]*)\\]`, 'm').exec(src);
  if (!m) return null;
  const body = m[1].trim().replace(/,$/, '');
  if (body === '') return [];
  const entries = body.split(',').map((e) => e.trim()).filter((e) => e !== '');
  const literal = entries.map((e) => /^'([^']*)'$/.exec(e) ?? /^"([^"]*)"$/.exec(e));
  return literal.every(Boolean) ? literal.map((x) => x[1]) : null;
};

// The uniform view over either format: `has(key)` (the field is declared at all,
// whatever its value), `scalar(key)` (a string, number or boolean, else
// undefined), `list(key)` (a list of strings; null when declared but unreadable).
// `format` says which file this was; `error` carries a JSON parse failure, in
// which case every reader answers "absent" and the caller reports the error.
// `code` is the comment-stripped source for the module form (as handed in) and
// the raw text for JSON, for the callers that still pattern-match one thing.
export function readDeclarationFields(path, code) {
  if (baseName(path) === TASK_DECLARATION_FILE) {
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
  return {
    format: 'mjs',
    error: null,
    object: null,
    code,
    has: (key) => new RegExp(at(key), 'm').test(code),
    scalar: (key) => mjsScalar(code, key),
    list: (key) => mjsStringList(code, key),
  };
}
