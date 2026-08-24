// Code-work, executor-side (tasks-dispatch DESIGN §6.5, §14). The contract is
// unchanged from the slot mechanism — a subprocess with the task dir as cwd, the
// declared `required_secrets` as environment, a hard timeout, and the conditional
// `CLAUDINITE_REQUEST_AGENT` hand-off — so this module is a thin adapter that
// gives the queue's item identity where the slot id used to go, and adds the two
// things the queue states explicitly:
//
//  - RE-ENTRANCY IS THE REQUIREMENT, NOT IDEMPOTENCY (§6). A dead executor's
//    claim is reclaimed and the item re-picked, so code-work can run again over its
//    own half-done work. That is convergence — check what exists, continue from
//    there — and it was always true of code-work; the contract simply never said so.
//    Since the heartbeat replaced the run cap (§15.15), overlap is no longer
//    excluded by construction: a partitioned runner keeps working while its beats
//    fail to post, its claim is reclaimed on that silence, and the replacement
//    starts. Re-entrancy is what makes that safe, which is why it is the contract.
//  - A DECLARED SECRET THAT IS NOT CONFIGURED IS NAMED, NOT GUESSED AT (§14.7).
//    Code-work is the only task code that ever sees a secret VALUE, so this is the
//    one place that can tell "unset" from "empty", and the item converges to
//    triage naming exactly which one is missing.

import { runCodeWork, codeWorkFailure, agentRequestPath, clearAgentRequest, agentRequested, readAgentRequest, readTriageMarker } from '../code-work.mjs';
import { SECRETS_BAG_ENV, secretsBag, secretValue, secretsFor } from './secrets-bag.mjs';

// The declared secrets this environment does not carry. Absent is missing; a
// set-but-empty one is the repo's own choice and is passed through. Read through
// the bag, which also answers for a legacy workflow that still stamps by name.
export const missingSecrets = (names = [], env = process.env) =>
  names.filter((n) => secretValue(n, env) === undefined);

// The environment a task's work step runs under: this job's, minus every secret,
// plus the ones this task declared. Selecting rather than inheriting is the point —
// the bag carries the whole repository's secrets, and a task's blast radius should
// be the list it wrote down (#1336). Under a workflow that names its secrets there is no
// bag to subtract, so the stamped names stay inherited until that member's own
// executor workflow lands; the fallback in secrets-bag.mjs states the retirement
// condition.
export function taskEnv(names = [], env = process.env) {
  const out = { ...env };
  delete out[SECRETS_BAG_ENV];
  for (const name of Object.keys(secretsBag(env) ?? {})) delete out[name];
  return { ...out, ...secretsFor(names, env) };
}

// The CLAUDINITE_* variables code-work is handed, and the whole of them: a worker
// reading any other one is reading something nobody sets, which is silent and
// permanent (a `CLAUDINITE_OVERRIDES` left over from the slot scheduler read as an
// empty bag, so a fleet sweep's REPOS filter and DRY_RUN switch were inert and
// every run was unscoped and live — #974).
//
// Built as one object so the NAMES cannot drift from what is actually passed:
// `CODE_WORK_ENV_VARS` below is this function's own key set, and the check that
// polices task workers reads it rather than a hand-kept list.
export const codeWorkEnv = ({ root, repo, defaultBranch, task, item, context = [], requestPath }) => ({
  CLAUDINITE_REPO_ROOT: root,
  CLAUDINITE_REPO: repo,
  CLAUDINITE_DEFAULT_BRANCH: defaultBranch ?? '',
  // The item's identity where the slot id used to be: the queue has no slot, and
  // the issue number IS the occurrence (§3).
  CLAUDINITE_ITEM: String(item.number),
  CLAUDINITE_PACK: task.pack,
  CLAUDINITE_TASK: task.id,
  // The item's binding scope, one line per Context bullet — and the channel an
  // operator's parameters ride (§8).
  CLAUDINITE_CONTEXT: context.join('\n'),
  CLAUDINITE_REQUEST_AGENT: requestPath,
});

export const CODE_WORK_ENV_VARS = Object.freeze(
  Object.keys(codeWorkEnv({ task: { pack: '', id: '' }, item: { number: 0 }, requestPath: '' })),
);

export function codeWorkRunner({ root, repo, defaultBranch, env = process.env }) {
  return async function runFor(task, { item, context = [] }) {
    const missing = missingSecrets(task.decl.required_secrets ?? [], env);
    if (missing.length) return { ok: true, agentRequested: false, missingSecrets: missing };

    const requestPath = agentRequestPath({ pack: task.pack, task: task.id, slotId: `item-${item.number}` });
    clearAgentRequest(requestPath);

    console.log(`::group::code_work ${task.pack}/${task.id} [#${item.number}]`);
    const result = await runCodeWork(task.decl.code_work, {
      taskDir: task.taskDir,
      env: { ...taskEnv(task.decl.required_secrets ?? [], env), ...codeWorkEnv({ root, repo, defaultBranch, task, item, context, requestPath }) },
      timeoutSeconds: task.decl.code_work_timeout,
    });
    console.log('::endgroup::');

    if (!result.ok) {
      clearAgentRequest(requestPath);
      const tail = result.stderr?.trim().split('\n').slice(-5).join('\n') ?? '';
      // Repeated OUTSIDE the group: Actions renders a group collapsed, so a failure
      // whose only evidence sits inside one still reads as unexplained.
      if (tail) console.log(tail);
      // The worker's own verdict on its failure, if it left one — read over BOTH
      // streams, since a marker is a diagnosis and workers print those wherever
      // they print everything else.
      return { ok: false, why: codeWorkFailure(result), detail: tail, triage: readTriageMarker(`${result.stdout}\n${result.stderr}`) };
    }

    const requested = agentRequested(requestPath);
    const payload = requested ? readAgentRequest(requestPath) : null;
    clearAgentRequest(requestPath);
    return {
      ok: true,
      agentRequested: requested,
      delivered: deliveredLines(payload?.delivered),
      // The unmerged PR, structured, beside its rendered line: an item whose run
      // left one parks for approval instead of closing, and that decision cannot
      // be made off a prose line.
      openPr: payload?.delivered?.pr && !payload.delivered.merged ? payload.delivered.pr : null,
      reason: payload?.reason ? (payload.reason.detail || payload.reason.code) : null,
    };
  };
}

// What code-work created, by identity — the agent's only source for those
// artifacts, and (absent an agent) what makes an outcome `delivered` rather than
// `done`. Absence is meaningful: a worker that created nothing writes no
// `delivered`, and the item then says nothing about artifacts rather than
// asserting something false.
export function deliveredLines(delivered) {
  const { branch = null, pr = null, merged = false, issue = null } = delivered ?? {};
  const out = [];
  if (pr) out.push(`PR: #${pr}${merged ? ' (already merged — open your own PR for further work)' : ' (open)'}`);
  if (branch) out.push(`Branch: \`${branch}\``);
  // An ISSUE this run resolved for the agent to write to — a task's standing
  // tracker, typically, found or created by its own code-work. Rendered for the same
  // reason a PR number is: the agent's only source for it is this line, and without
  // it a worker that took the trouble to resolve one hands over nothing.
  if (issue) out.push(`Issue: #${issue} — write this run's record there.`);
  return out;
}
