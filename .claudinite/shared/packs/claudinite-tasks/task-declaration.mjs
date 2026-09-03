// Where a task's declaration lives and how it is loaded — the one place that
// knows a task folder may spell its declaration two ways (task-declaration-text.mjs
// says which two and why). Everything that resolves a declaration — discovery, the
// dispatch validators, the checks that gate on a task folder — goes through the
// names here, so the retirement of the module form is one edit in one file.

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TASK_DECLARATION_FILE, LEGACY_TASK_DECLARATION_FILE, TASK_DECLARATION_FILES, parseTaskDeclaration } from './task-declaration-text.mjs';

export * from './task-declaration-text.mjs';

// The declaration file a task directory carries, or null when it carries none.
// Both present is not "prefer one": it is two declarations for one task, and the
// caller reports it rather than guessing which the author meant.
export function findTaskDeclaration(taskDir) {
  const present = TASK_DECLARATION_FILES.filter((name) => existsSync(join(taskDir, name)));
  if (present.length === 0) return null;
  if (present.length > 1) {
    throw new Error(`${taskDir} carries both ${present.join(' and ')} — delete ${LEGACY_TASK_DECLARATION_FILE}, ${TASK_DECLARATION_FILE} is the declaration`);
  }
  return join(taskDir, present[0]);
}

// The declaration's raw object, before normalization. A JSON file that does not
// parse, or a module that does not import, throws with the file's own message —
// the callers turn that into a per-task error, never a sunk scan.
export async function loadTaskDeclaration(file) {
  if (basename(file) === TASK_DECLARATION_FILE) return parseTaskDeclaration(readFileSync(file, 'utf8'));
  return (await import(pathToFileURL(file).href)).default;
}

// The declaration file a `.../tasks/<name>/task.md` path's folder carries, given
// only an `exists` capability over repo-relative paths (the dispatch validator's
// world). Same rule as `findTaskDeclaration`; a folder with both returns null with
// `both: true` so the caller can say so.
export function siblingTaskDeclaration(taskMdPath, exists) {
  const dir = dirname(taskMdPath);
  const present = TASK_DECLARATION_FILES.map((name) => `${dir}/${name}`).filter((p) => exists(p));
  if (present.length === 1) return { file: present[0], both: false };
  return { file: null, both: present.length > 1 };
}
