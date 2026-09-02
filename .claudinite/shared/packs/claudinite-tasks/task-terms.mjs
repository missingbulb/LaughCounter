// Loading a task's OWN precondition terms — the extension mechanism the built-in
// vocabulary leaves room for (task-preconditions DESIGN, "The term vocabulary").
// A task whose gate is its own (an age against a configured retention, a manifest
// against a release tag, a fleet read) ships `preconditions.mjs` beside its
// `task.mjs`, exporting `terms`: a map from term name to
// `{ signals, takesArg?, holds(signals, opts) }`. The term's code then lives
// beside its only consumer, so reading the declaration and reading the gate are
// one directory apart.
//
// Split from precondition-policy.mjs, which stays pure over the signals: this is
// the half that touches the filesystem, and the evaluator is handed the result.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { termsMap } from './precondition-policy.mjs';

export const TASK_TERMS_FILE = 'preconditions.mjs';

// The terms a task directory contributes — an empty map when it ships no file.
// A file that will not import THROWS: the caller (discovery, dispatch
// validation) reports the task as broken, which is the loud direction. A task
// whose gate cannot be loaded must not fall back to running unconditionally.
export async function loadTaskTerms(taskDir) {
  const file = join(taskDir, TASK_TERMS_FILE);
  if (!existsSync(file)) return new Map();
  return termsMap((await import(pathToFileURL(file).href)).terms);
}
