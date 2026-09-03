// Task discovery for the scheduler (per-project-scheduling DESIGN §3.2). One
// uniform scan of every ACTIVE pack's `tasks/<name>/task.json`, activation-gated
// by the repo's `packs` declaration exactly like checks and skills. Reuses the
// pack registry so the same scan works across all three layouts without knowing
// any of them: canon packs at `packs/`, a consumer's vendored canon at
// `.claudinite/shared/packs/`, and local packs at `.claudinite/local/packs/`
// (each pack carries its own resolved `dir`).
//
// Frequency filtering is deliberately NOT done here — discover returns every
// active, well-formed task; the scheduler run intersects them with the current anchors
// (queue/anchors.mjs). Keeping the two apart keeps each pure and separately
// testable. A task whose declaration fails to load or violates the declaration
// contract is dropped into `errors` (fail-soft, per-task), never sinking the
// scan.

import { readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { loadPacks, isActive } from '../../engine/pack_loader/pack-registry.mjs';
import { normalizeTaskDeclaration, validateTaskDeclaration } from './task-contract.mjs';
import { findTaskDeclaration, loadTaskDeclaration } from './task-declaration.mjs';
import { loadTaskTerms } from './task-terms.mjs';
import { BUILT_IN_PACK, builtInTasksRoot } from './built-in-tasks.mjs';

// Discover every task the repo's active packs contribute. Returns
// `{ tasks, errors }` where each task is
// `{ pack, id, taskDir, taskPath, decl, terms }` — `taskPath` is the repo-relative
// path to the worker file's directory's task.md (the work item's first
// line), `decl` the validated declaration, and `terms` whatever precondition
// terms the task ships of its own (an empty map for most).
export async function discoverTasks(root, config) {
  const errors = [];
  const packs = await loadPacks({ localRoot: root });
  const active = packs.filter((p) => isActive(p, config));

  // The BUILT-IN root beside the pack scan (DESIGN §16.2). The engine ships one
  // task of its own — the request implementer — so a marked issue is an ordinary
  // run rather than a special item shape. It is not a pack and declares nothing:
  // wherever the queue runs, it is active, which is also what stops any pack
  // opting itself into the fields only it may declare.
  const roots = [...active.map((p) => ({ id: p.id, dir: join(p.dir, 'tasks') }))];
  const builtIn = builtInTasksRoot(root);
  if (builtIn) roots.push({ id: BUILT_IN_PACK, dir: builtIn });

  const tasks = [];
  for (const pack of roots) {
    const tasksRoot = pack.dir;
    if (!existsSync(tasksRoot)) continue;
    let names;
    try {
      names = readdirSync(tasksRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory()).map((d) => d.name).sort();
    } catch (e) {
      errors.push({ pack: pack.id, what: `${pack.id}'s tasks/ is not a readable directory: ${e.message}`, fix: `make ${relative(root, tasksRoot)} a directory (or remove it)` });
      continue;
    }
    for (const name of names) {
      const taskDir = join(tasksRoot, name);
      let file;
      try {
        file = findTaskDeclaration(taskDir);
      } catch (e) {
        errors.push({ pack: pack.id, task: name, what: e.message, fix: 'delete the task.mjs — task.json is the declaration' });
        continue;
      }
      if (file === null) continue;
      let decl;
      try {
        // Canonical field names and the defaults from here on (legacy code-work
        // names accepted at the door, never re-checked downstream).
        decl = normalizeTaskDeclaration(await loadTaskDeclaration(file));
      } catch (e) {
        errors.push({ pack: pack.id, task: name, what: `${relative(root, file)} failed to load: ${e.message}`, fix: 'fix or remove the task' });
        continue;
      }
      // The task's own precondition terms, loaded BEFORE validation: a
      // declaration naming one is well-formed only against the file that defines
      // it, so a terms file that will not import fails the task rather than
      // making its own conditions look like typos.
      let terms;
      try {
        terms = await loadTaskTerms(taskDir);
      } catch (e) {
        errors.push({ pack: pack.id, task: name, what: `${relative(root, join(taskDir, 'preconditions.mjs'))} failed to import: ${e.message}`, fix: 'fix or remove the task\'s precondition terms' });
        continue;
      }
      const problems = validateTaskDeclaration(decl, terms);
      if (problems.length) {
        errors.push({ pack: pack.id, task: name, what: `${relative(root, file)} is not a valid task declaration: ${problems.map((p) => p.what).join('; ')}`, fix: problems[0].fix });
        continue;
      }
      // A local pack's dir-name is its id (enforced by the registry); the task's
      // directory name should likewise match its declared id — a mismatch would
      // make the dispatch path and the declaration disagree.
      if (decl.id !== name) {
        errors.push({ pack: pack.id, task: name, what: `task in ${relative(root, taskDir)} declares id "${decl.id}" but its directory is "${name}"`, fix: 'rename the directory to the task id, or set the id to the directory name' });
        continue;
      }
      tasks.push({
        pack: pack.id,
        id: decl.id,
        taskDir,
        taskPath: `${relative(root, taskDir).split('\\').join('/')}/task.md`,
        decl,
        terms,
      });
    }
  }
  return { tasks, errors };
}
