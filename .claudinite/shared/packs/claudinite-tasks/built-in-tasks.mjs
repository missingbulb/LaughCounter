// The tasks the ENGINE itself ships (tasks-dispatch DESIGN §16.2), as opposed to
// the ones a declared pack contributes. There is exactly one: `implement-request`,
// the task a marked issue's work item names.
//
// It is a TASK rather than a special item shape because that is what keeps the
// request mode from being a second mechanism — the item's first body line is a task
// path validated in code like every other, the same-title mutex serializes twin
// requests, the janitor's leashes cover it, `verify-outcome` polices its ceiling and
// `record-exec` counts it. What follows from it being engine-owned rather than
// pack-owned is exactly two things, and they live here: task discovery gains this
// root beside the pack scan, and the validated task-path shape gains its form.
//
// It is not a pack and declares nothing. Wherever the queue runs it is active,
// which is also what fences the one field only it may declare
// (`model_from_request`): no pack can opt itself in, because no pack can be this.

import { existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// The id the built-in task's work items are titled with — `engine/implement-request`
// — in the same `<pack>/<task>` grammar as everything else, so nothing downstream
// needs a second parse.
export const BUILT_IN_PACK = 'engine';
export const REQUEST_TASK = 'implement-request';
export const REQUEST_TASK_ID = `${BUILT_IN_PACK}/${REQUEST_TASK}`;

// Where this engine's own tasks live, resolved from THIS MODULE rather than probed
// against the repo: the engine root is wherever this file was vendored to, which is
// `engine/` in the canon and `.claudinite/shared/engine/` in a member, and asking
// the module cannot get that wrong the way a two-root probe can.
export const builtInTasksDir = () => join(dirname(fileURLToPath(import.meta.url)), 'queue', 'tasks');

// The same directory as a path INSIDE the given repo root, or null when it is not
// inside it. Null is a real answer rather than an error: a test importing the canon
// engine against a fixture root is exactly that case, and the built-in task must
// then simply not be discovered there.
export function builtInTasksRoot(root) {
  const dir = builtInTasksDir();
  if (!existsSync(dir)) return null;
  const rel = relative(root, dir);
  if (!rel || rel.startsWith('..') || rel.startsWith(sep)) return null;
  return dir;
}

// The request task's repo-relative worker path, in the form a work item's first
// line carries. Null where the engine is not inside this root (see above).
export function requestTaskPath(root) {
  const dir = builtInTasksRoot(root);
  return dir ? `${relative(root, join(dir, REQUEST_TASK)).split('\\').join('/')}/task.md` : null;
}

// THE APPROVAL PHRASE. A comment beginning `/claude go` is how somebody with push
// access blesses an issue they did not open (DESIGN §16.4) — the blessing is the
// comment, never the mark. It lives here because two places need the same one: the
// `request` signal, which reads which logins wrote it, and the request task's
// precondition, which judges their permission.
export const APPROVAL_RE = /^\s*\/claude\s+go\b/im;

// The shapes a built-in task path may take, mirroring `DISPATCH_PATH_RE`'s job for pack
// tasks. The `.claudinite/shared/` prefix is optional for the same reason: a member's
// mount is there, the canon runs its own tree.
//
// TWO ROOTS, and both are permanent. The path is DERIVED from where this module sits,
// so the move to the tasks pack (#1317) changed what a new dispatch carries while every
// item minted before it still carries `engine/scheduler/`. This regex is a VALIDATOR,
// not a decoder: a shape it does not know is rejected outright, so dropping either one
// stops that half of the ad-hoc request lane on every single request.
export const BUILT_IN_PATH_RE = /^(?:\.claudinite\/shared\/)?(?:engine\/scheduler|packs\/claudinite-tasks)\/queue\/tasks\/([^/]+)\/task\.md$/;
