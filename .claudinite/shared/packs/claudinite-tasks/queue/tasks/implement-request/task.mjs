// The request implementer (tasks-dispatch DESIGN §16) — the engine's one built-in
// task, and the only one that may read an item's `Model`.
//
// A person marks an ordinary issue `task:origin:ad-hoc`; the scheduler run adopts
// it by writing the machine block onto that issue and applying the first status —
// the issue IS the item (§16.1); this task's precondition decides, at pickup,
// whether the run happens; the session implements the issue and leaves a pull
// request. There is no code-work phase at all: the authorization a worker would
// have performed is the precondition's, and the item's `Request:` field — which
// names the item's own issue — is the whole payload.

// Push permission, as the permission API answers it. `triage` and `read` are
// deliberately not here: the ask was push access, and a read-only collaborator
// rides every webhook payload as `COLLABORATOR` (F30).
export const PUSH_PERMISSIONS = ['admin', 'maintain', 'write'];

// Who, if anyone, with push access asked for this. Pure over the `request` signal's
// read, so the judgment is testable without GitHub and the reads stay where every
// other read is.
export function eligibility(req) {
  if (PUSH_PERMISSIONS.includes(req.authorPermission)) {
    return { ok: true, why: `opened by @${req.author}, who has push access` };
  }
  const blessed = (req.approvals ?? []).find((a) => PUSH_PERMISSIONS.includes(a.permission));
  if (blessed) return { ok: true, why: `approved by @${blessed.login} with \`/claude go\`` };
  return { ok: false, why: 'neither opened nor approved with `/claude go` by anyone with push access on this repository' };
}

export default {
  // The literal, not the constant beside it in `built-in-tasks.mjs`: the
  // declaration-shape check reads this file statically and cannot resolve an
  // import. The two are pinned to each other in request-mode.test.mjs.
  id: 'implement-request',
  // MANUAL: the scheduler run never puts this on a calendar. An item exists only because an
  // issue was marked, which is what makes a request a first-class origin of work
  // rather than a schedule nobody asked for.
  frequency: 'manual',
  // The read the precondition judges on. It is collected for THIS item — the issue
  // its `Request:` field names — which is why the precondition takes the item.
  precondition_signals: ['request'],
  // The default when the asker named no family; the item's `Model:` overrides it,
  // and only because this task declares the field below.
  agent_model: 'opus',
  model_from_request: true,
  // The ceiling the executor enforces in code. The task's own policy is the full
  // `anything` because the REAL decider is per-request: the asker's `Automerge:`
  // becomes the item's `Merge:` field (§16.11), a policy expression the worker
  // hands to the policy engine, and the task ceiling must not sit below whatever
  // an asker may legitimately authorize. A ceiling is a maximum, not an
  // instruction: with no such field the worker opens a pull request and parks at
  // the approval lane exactly as every request did before, and with one it still
  // parks whenever the policy engine says the diff is not covered.
  expected_outcome: 'pr',
  automerge: 'anything',
  agent_instructions: 'task.md',
  agent_execution_timeout: 4 * 3600,
  // A run that died mid-flight leaves a branch, a PR, or neither, and only a person
  // can say whether the half-done work stands — so nothing re-queues it mechanically.
  on_interrupt: 'needs-human',

  // THE SECURITY CHECK, and it happens where every verdict happens: once, at pickup,
  // on the executor (§6.4). Three refusals, each a plain no-go that converges the
  // item to the rejected terminal — a refusal is nobody's inbox, and an ad-hoc item
  // has no anchor to roll to. On a marked issue that terminal stands on the OPEN
  // issue: the run's verdict is not the issue's validity (§16.5).
  //
  // A READ FAILURE IS NOT A VERDICT (F27). The decline's write-back cannot reach an
  // issue it cannot read, so declining on a rate limit or a 500 would strand
  // `claude-queued` on the issue forever over nothing — the request silently eaten.
  // Only a definitive `gone` declines; anything else FAILS the run, which parks the
  // item open in the failure lane where the ordinary re-queue lever retries it.
  precondition(signals, config, item) {
    const req = signals.request;
    if (!req) {
      return { error: `this item names no readable request (its \`Request:\` field is ${item?.request ? `#${item.request}` : 'missing'})` };
    }
    if (req.unreadable) return { error: `issue #${req.number} could not be read: ${req.error} — refusing to guess` };
    if (req.gone) return { run: false, reason: `issue #${req.number} does not exist` };
    if (req.state !== 'open') return { run: false, reason: `issue #${req.number} was closed before this ran` };
    if (!req.queued) {
      return { run: false, reason: `issue #${req.number} no longer carries the mark — the request was withdrawn` };
    }
    const verdict = eligibility(req);
    return verdict.ok
      // No `context`: adoption already bound this item to its issue, and a second
      // line saying the same thing renders as two near-identical bullets in the one
      // section the session is told to read as its scope (seen on the first live
      // request, #1074/#1075).
      ? { run: true, reason: `#${req.number}: ${verdict.why}` }
      : { run: false, reason: `#${req.number}: ${verdict.why}` };
  },
};
