// Executor-side deterministic validation of a dispatch issue, BEFORE any model
// judgment (per-project-scheduling DESIGN §5.2). Given the issue body, it asserts
// in code that the first line is a legal task path, the task file exists at HEAD,
// its pack is declared, and its `task.mjs` sibling parses to a well-formed
// declaration — then resolves the model and outcome ceiling the executor will
// enforce. An invalid dispatch is rejected (the executor de-labels it and
// converges it to needs-human), so a forged or mangled issue never runs.
//
// Pure over injected capabilities so it unit-tests without a repo or GitHub. It
// is NOT a CLI — the executor shell beside it, `resolve-dispatch.mjs`, is what
// drives it in production: that shell takes the issue body out of the label
// event's payload on disk and wires `exists`/`isPackDeclared`/`loadTask` to the
// checkout, so validating a dispatch costs no GitHub call at all.

import { normalizeTaskDeclaration, validateTaskDeclaration } from './task-contract.mjs';
import { resolveModel } from './model-map.mjs';
import { BUILT_IN_PACK, BUILT_IN_PATH_RE } from './built-in-tasks.mjs';
import { parseWorkItemBody } from './queue/work-item.mjs';

// The only shape a dispatch first line may take (DESIGN §5.2). Anchored end to
// end — no query strings, no trailing junk, exactly one pack and one task
// segment under a packs/ root. The `.claudinite/(shared|local)/` prefix is
// OPTIONAL: a consumer's task path carries it (its canon is mounted at
// `.claudinite/shared/packs/`, its own packs at `.claudinite/local/packs/`),
// while the CANON repo runs its own tree and dispatches root-relative paths
// (`packs/<pack>/…` for its canon packs, `.claudinite/local/packs/<pack>/…` for
// its local packs). All three forms are legal; nothing else is.
export const DISPATCH_PATH_RE = /^(?:\.claudinite\/(?:shared|local)\/)?packs\/([^/]+)\/tasks\/([^/]+)\/task\.md$/;

// The task path a dispatch body points at — its first line, trimmed.
export const dispatchFirstLine = (body) => String(body ?? '').split('\n')[0].trim();

const reject = (reason, extra = {}) => ({ ok: false, reason, ...extra });

// Validate a dispatch body. Capabilities (all injected for testability):
//   exists(path)        -> boolean   — does this repo-relative path exist at HEAD
//   isPackDeclared(id)  -> boolean   — is this pack active in .claudinite-settings.json
//   loadTask(mjsPath)   -> decl      — load the task.mjs default export (throws on parse error)
// Returns { ok:true, pack, task, taskPath, model, resolvedModel, outcome },
// { ok:false, gone:true, pack, task, reason } — a well-formed dispatch whose task
// the repo NO LONGER CARRIES (file gone, sibling gone, pack undeclared): the
// executor CLOSES the issue as obsolete (owner, 2026-08-06) rather than parking
// it on needs-human, because a task that was removed or deactivated is not an
// anomaly a human needs to triage — or { ok:false, reason } for a genuinely
// malformed dispatch (bad path shape, unparseable declaration), which stays a
// needs-human convergence since it may be forgery or a broken task.
export function validateDispatchBody(body, { exists, isPackDeclared, loadTask }) {
  const firstLine = dispatchFirstLine(body);
  // Two legal shapes: a pack task, and the engine's own built-in root (DESIGN
  // §16.2). The built-in one is not a pack and is never declared — wherever the
  // queue runs it is active — so it skips the declaration check rather than failing
  // it, and nothing else about validation differs.
  const builtIn = BUILT_IN_PATH_RE.exec(firstLine);
  const m = builtIn ? [firstLine, BUILT_IN_PACK, builtIn[1]] : DISPATCH_PATH_RE.exec(firstLine);
  if (!m) return reject(`first line "${firstLine}" is not a valid task path (${DISPATCH_PATH_RE})`);

  const [, pack, task] = m;
  const taskPath = firstLine;
  const mjsPath = taskPath.replace(/task\.md$/, 'task.mjs');

  const gone = (reason) => reject(reason, { gone: true, pack, task });
  if (!exists(taskPath)) return gone(`task file ${taskPath} does not exist at HEAD — the repo no longer carries this task`);
  if (!exists(mjsPath)) return gone(`the task.mjs sibling ${mjsPath} is missing — the repo no longer carries this task`);
  if (!builtIn && !isPackDeclared(pack)) return gone(`pack "${pack}" is not declared in .claudinite-settings.json — this task is not active here`);

  let decl;
  try {
    decl = normalizeTaskDeclaration(loadTask(mjsPath));
  } catch (e) {
    return reject(`${mjsPath} did not parse: ${e.message}`, { pack, task });
  }
  const problems = validateTaskDeclaration(decl);
  if (problems.length) return reject(`${mjsPath} is not a valid task declaration: ${problems.map((p) => p.what).join('; ')}`, { pack, task });

  // The model a task that reads its item's choice runs at (DESIGN §16.7). The field
  // is written by the scheduler run from a write-gated label and validated on the way out of
  // the parser, so an unrecognised family has already become absent here and the
  // declared default stands — a request nobody can run would look accepted forever.
  const model = (decl.model_from_request && parseWorkItemBody(body).model) || decl.agent_model;

  return {
    ok: true,
    pack,
    task,
    taskPath,
    model,
    resolvedModel: resolveModel(model),
    outcome: decl.expected_outcome,
    // The best-effort run bound (task-code-work DESIGN §6): the executor
    // surfaces it into the subagent's brief as "fail after N minutes". Always set
    // for an agentic task (the contract requires it); null for an agentless one.
    executionTimeout: decl.agent_execution_timeout ?? null,
  };
}
