// Prework, executor-side (tasks-dispatch DESIGN §6.5, §14). The contract is
// unchanged from the slot mechanism — a subprocess with the task dir as cwd, the
// declared `required_secrets` as environment, a hard timeout, and the conditional
// `CLAUDINITE_REQUEST_AGENT` hand-off — so this module is a thin adapter that
// gives the queue's item identity where the slot id used to go, and adds the two
// things the queue states explicitly:
//
//  - RE-ENTRANCY IS THE REQUIREMENT, NOT IDEMPOTENCY (§6). A dead executor's
//    claim is reclaimed and the item re-picked, so prework can run again over its
//    own half-done work. That is convergence — check what exists, continue from
//    there — and it was always true of prework; the contract simply never said so.
//    Concurrent overlap with a zombie run is excluded by construction (the
//    executor job's timeout-minutes ≤ the executing leash), never asked of a task.
//  - A DECLARED SECRET THAT IS NOT CONFIGURED IS NAMED, NOT GUESSED AT (§14.7).
//    Prework is the only task code that ever sees a secret VALUE, so this is the
//    one place that can tell "unset" from "empty", and the item converges to
//    triage naming exactly which one is missing.

import { runPrework, preworkFailure, agentRequestPath, clearAgentRequest, agentRequested, readAgentRequest } from '../prework.mjs';

// The declared secrets this environment does not carry. An unset variable is
// missing; a set-but-empty one is the repo's own choice and is passed through.
export const missingSecrets = (names = [], env = process.env) =>
  names.filter((n) => env[n] === undefined);

export function preworkRunner({ root, repo, defaultBranch, env = process.env }) {
  return async function runFor(task, { item, context = [] }) {
    const missing = missingSecrets(task.decl.required_secrets ?? [], env);
    if (missing.length) return { ok: true, agentRequested: false, missingSecrets: missing };

    // The item's identity where the slot id used to be: the queue has no slot, and
    // the issue number IS the occurrence (§3). Workers read CLAUDINITE_ITEM.
    const requestPath = agentRequestPath({ pack: task.pack, task: task.id, slotId: `item-${item.number}` });
    clearAgentRequest(requestPath);

    console.log(`::group::prework ${task.pack}/${task.id} [#${item.number}]`);
    const result = await runPrework(task.decl.prework, {
      taskDir: task.taskDir,
      env: {
        ...env,
        CLAUDINITE_REPO_ROOT: root,
        CLAUDINITE_REPO: repo,
        CLAUDINITE_DEFAULT_BRANCH: defaultBranch ?? '',
        CLAUDINITE_ITEM: String(item.number),
        CLAUDINITE_PACK: task.pack,
        CLAUDINITE_TASK: task.id,
        CLAUDINITE_CONTEXT: context.join('\n'),
        CLAUDINITE_REQUEST_AGENT: requestPath,
      },
      timeoutSeconds: task.decl.prework_timeout,
    });
    console.log('::endgroup::');

    if (!result.ok) {
      clearAgentRequest(requestPath);
      const tail = result.stderr?.trim().split('\n').slice(-5).join('\n') ?? '';
      // Repeated OUTSIDE the group: Actions renders a group collapsed, so a failure
      // whose only evidence sits inside one still reads as unexplained.
      if (tail) console.log(tail);
      return { ok: false, why: preworkFailure(result), detail: tail };
    }

    const requested = agentRequested(requestPath);
    const payload = requested ? readAgentRequest(requestPath) : null;
    clearAgentRequest(requestPath);
    return {
      ok: true,
      agentRequested: requested,
      delivered: deliveredLines(payload?.delivered),
      reason: payload?.reason ? (payload.reason.detail || payload.reason.code) : null,
    };
  };
}

// What prework created, by identity — the agent's only source for those
// artifacts, and (absent an agent) what makes an outcome `delivered` rather than
// `done`. Absence is meaningful: a worker that created nothing writes no
// `delivered`, and the item then says nothing about artifacts rather than
// asserting something false.
export function deliveredLines(delivered) {
  const { branch = null, pr = null, merged = false } = delivered ?? {};
  const out = [];
  if (pr) out.push(`PR: #${pr}${merged ? ' (already merged — open your own PR for further work)' : ' (open)'}`);
  if (branch) out.push(`Branch: \`${branch}\``);
  return out;
}
