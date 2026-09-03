#!/usr/bin/env node
// Convert task declarations from the retired module form (`tasks/<name>/task.mjs`,
// a default-exported object literal) to the data form (`task.json`, pointing at
// the task schema through `$schema`), deleting the module once its JSON exists.
//
// Two callers. The `task-declarations-json` migration record runs this against a
// member's OWN local packs on its nightly update, through the registry's io
// capabilities, so a member converts without anyone remembering to; and the CLI
// below converts a checkout by hand — the canon's own packs, or a member that
// wants it done sooner:
//
//   node engine/migrations/task-declarations-to-json.mjs [--root <repo>] [<task dir>…]
//
// The module's comments cannot survive in the JSON, so they move to the task's
// `README.md`, under one heading, verbatim — mostly they restated the assignment
// beside them, but what was rationale is then still where a reader of the task
// looks, and the update's apply stage reads it to write the task's `description`.
// The conversion prints each block too. A field that is not data (the retired
// `precondition()` function) is dropped, and named in the report line: the
// contract rejects it either way.

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, posix } from 'node:path';
import { pathToFileURL } from 'node:url';

export const TASK_JSON = 'task.json';
export const TASK_MJS = 'task.mjs';

// The schema every converted file points at, in the two-root form: a member reads
// it out of its mount, the canon out of its own tree.
export const SCHEMA_FILE = 'packs/claudinite-tasks/task.schema.json';
export const schemaPath = (exists) => (exists(`.claudinite/shared/${SCHEMA_FILE}`) ? `.claudinite/shared/${SCHEMA_FILE}` : SCHEMA_FILE);

// The pack roots a checkout's tasks live under. A member's own are the local
// packs; the canon also carries the shared packs at the repo root.
export const LOCAL_PACK_ROOT = '.claudinite/local/packs';
export const CANON_PACK_ROOT = 'packs';

// The order a declaration's keys are written in, grouped by what they say: what
// the task is, when it runs, what it may write, then the two phases — code work,
// then the agent. A key not listed keeps its place after the listed ones.
export const KEY_ORDER = [
  '$schema', 'id', 'description',
  'frequency', 'schedule_after', 'preconditions',
  'expected_outcome', 'automerge', 'on_interrupt', 'invocation_endpoint',
  'code_work', 'code_work_timeout', 'code_work_required_secrets',
  'agent_model', 'model_from_request', 'agent_instructions', 'agent_execution_timeout',
];
export function orderTaskKeys(decl) {
  const rank = (k) => { const i = KEY_ORDER.indexOf(k); return i === -1 ? KEY_ORDER.length : i; };
  return Object.fromEntries(Object.entries(decl).sort(([a], [b]) => rank(a) - rank(b)));
}

// The JSON text for a declaration object, keys in KEY_ORDER. Returns the keys
// that could not be carried (functions, undefined) so the caller can say so.
export function serializeTaskDeclaration(decl, schemaRelative) {
  const dropped = Object.keys(decl).filter((k) => typeof decl[k] === 'function' || decl[k] === undefined);
  const data = Object.fromEntries(Object.entries(decl).filter(([k]) => !dropped.includes(k)));
  return { text: `${JSON.stringify(orderTaskKeys({ $schema: schemaRelative, ...data }), null, 2)}\n`, dropped };
}

// The comment lines a module carried, for the report: everything outside the
// object literal, so a header explaining why the task exists is not lost silently.
export function moduleComments(source) {
  const out = [];
  for (const line of source.split('\n')) {
    const whole = /^\s*(\/\/|\/\*|\*\/|\*)\s?(.*)$/.exec(line);
    if (whole) { out.push(whole[2]); continue; }
    // A trailing `// …` on a field line — the value's own note. A `//` inside a
    // string value (a URL) is not one; the field's quote closes before the marker.
    const trailing = /^[^'"]*(?:'[^']*'|"[^"]*")?[^'"]*?\s\/\/\s?(.*)$/.exec(line);
    if (trailing) out.push(trailing[1]);
  }
  return out.join('\n').trim();
}

// Every `<root>/<pack>/tasks/<task>/` directory under the given pack roots that
// carries a task.mjs, repo-relative and posix. `listDir(p)` returns the entry
// names of a directory, or null when it is not one.
export function taskDirsWithModule(packRoots, { listDir, exists }) {
  const out = [];
  for (const root of packRoots) {
    for (const pack of listDir(root) ?? []) {
      const tasks = `${root}/${pack}/tasks`;
      for (const task of listDir(tasks) ?? []) {
        const dir = `${tasks}/${task}`;
        if (exists(`${dir}/${TASK_MJS}`)) out.push(dir);
      }
    }
  }
  return out.sort();
}

// The section a task's README gains for its module's comments.
export const NOTES_HEADING = '## Why the declaration reads as it does';
export function readmeWithNotes(existing, id, comments) {
  const section = `\n${NOTES_HEADING}\n\nCarried over from the declaration's comments when it became ${TASK_JSON}.\n\n${comments}\n`;
  return `${existing ? `${existing.replace(/\n*$/, '\n')}` : `# ${id}\n`}${section}`;
}

// Convert the task.mjs in each directory. Capabilities, all repo-relative:
//   exists(p), read(p), write(p, text), remove(p), importModule(p) -> module
// Returns one report line per directory. A directory already carrying a
// task.json keeps it and only loses the module — the JSON is the declaration,
// and a second conversion must not clobber an edit made since the first.
export async function convertTaskDeclarations(taskDirs, io) {
  const schema = schemaPath(io.exists);
  const applied = [];
  for (const dir of taskDirs) {
    const mjs = `${dir}/${TASK_MJS}`;
    const json = `${dir}/${TASK_JSON}`;
    if (!io.exists(mjs)) continue;
    if (io.exists(json)) {
      io.remove(mjs);
      applied.push(`${mjs}: deleted — ${json} already exists and is the declaration`);
      continue;
    }
    const decl = (await io.importModule(mjs)).default;
    if (decl === null || typeof decl !== 'object' || Array.isArray(decl)) {
      applied.push(`${mjs}: not converted — its default export is not a declaration object`);
      continue;
    }
    const comments = moduleComments(io.read(mjs) ?? '');
    const { text, dropped } = serializeTaskDeclaration(decl, posix.relative(dir, schema));
    io.write(json, text);
    io.remove(mjs);
    if (comments) {
      const readme = `${dir}/README.md`;
      io.write(readme, readmeWithNotes(io.read(readme), decl.id ?? dir.slice(dir.lastIndexOf('/') + 1), comments));
    }
    applied.push(`${mjs} -> ${json}${dropped.length ? ` (dropped non-data field${dropped.length > 1 ? 's' : ''}: ${dropped.join(', ')})` : ''}`
      + (comments ? `\n  comments not carried over:\n${comments.split('\n').map((l) => `    ${l}`).join('\n')}` : ''));
  }
  return applied;
}

// The io over a real checkout — the same capability names the migration
// registry's callers build, so the record and the CLI run one converter.
export function checkoutIo(root) {
  const abs = (p) => join(root, p);
  return {
    exists: (p) => existsSync(abs(p)),
    read: (p) => (existsSync(abs(p)) ? readFileSync(abs(p), 'utf8') : null),
    write: (p, text) => { mkdirSync(dirname(abs(p)), { recursive: true }); writeFileSync(abs(p), text); },
    remove: (p) => rmSync(abs(p), { force: true }),
    listDir: (p) => { try { return readdirSync(abs(p)); } catch { return null; } },
    importModule: (p) => import(pathToFileURL(abs(p)).href),
  };
}

export async function main(argv = process.argv.slice(2)) {
  let root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const dirs = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = argv[++i];
    else dirs.push(argv[i]);
  }
  const io = checkoutIo(root);
  const targets = dirs.length
    ? dirs.map((d) => posix.normalize(relative(root, join(root, d)).split('\\').join('/')))
    : taskDirsWithModule([CANON_PACK_ROOT, LOCAL_PACK_ROOT], io);
  const applied = await convertTaskDeclarations(targets, io);
  console.log(applied.length ? applied.join('\n') : 'no task.mjs to convert');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`task-declarations-to-json failed: ${e.message}`); process.exit(1); });
}
