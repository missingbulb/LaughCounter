// Where a task's declaration lives and how it is loaded (task-declaration-text.mjs
// says what a task.json is and how its fields are read). Everything that resolves
// a declaration — discovery, the dispatch validators, the checks that gate on a
// task folder — goes through the names here.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { TASK_DECLARATION_FILE, parseTaskDeclaration } from './task-declaration-text.mjs';

export * from './task-declaration-text.mjs';

// The declaration file a task directory carries, or null when it carries none.
export function findTaskDeclaration(taskDir) {
  return existsSync(join(taskDir, TASK_DECLARATION_FILE)) ? join(taskDir, TASK_DECLARATION_FILE) : null;
}

// The declaration's raw object, before normalization. A file that does not
// parse throws with its own message — the callers turn that into a per-task
// error, never a sunk scan.
export async function loadTaskDeclaration(file) {
  return parseTaskDeclaration(readFileSync(file, 'utf8'));
}

// The declaration file a `.../tasks/<name>/task.md` path's folder carries, given
// only an `exists` capability over repo-relative paths (the dispatch validator's
// world).
export function siblingTaskDeclaration(taskMdPath, exists) {
  const file = `${dirname(taskMdPath)}/${TASK_DECLARATION_FILE}`;
  return exists(file) ? file : null;
}
