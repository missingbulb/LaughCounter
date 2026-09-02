// THE SECURITY CHECK for the request implementer, as a precondition term — the
// one gate that decides whether a marked issue actually runs. It happens where
// every verdict happens: once, at pickup, on the executor (tasks-dispatch DESIGN
// §6.4). It is task-local because its subject is one named issue rather than a
// window of repo activity, which is also why the term reads the `item` it is
// handed.
//
// Three refusals, each a plain no-go that converges the item to the rejected
// terminal — a refusal is nobody's inbox, and an ad-hoc item has no anchor to
// roll to. On a marked issue that terminal stands on the OPEN issue: the run's
// verdict is not the issue's validity (§16.5).
//
// A READ FAILURE IS NOT A VERDICT (F27). The decline's write-back cannot reach an
// issue it cannot read, so declining on a rate limit or a 500 would strand the
// mark on the issue forever over nothing — the request silently eaten. Only a
// definitive `gone` declines; anything else ERRORS, which parks the item open in
// the failure lane where the ordinary re-queue lever retries it.

// Push permission, as the permission API answers it. `triage` and `read` are
// deliberately not here: the ask was push access, and a read-only collaborator
// rides every webhook payload as `COLLABORATOR` (F30).
export const PUSH_PERMISSIONS = ['admin', 'maintain', 'write'];

// Who, if anyone, with push access asked for this. Pure over the `request`
// signal's read, so the judgment is testable without GitHub and the reads stay
// where every other read is.
export function eligibility(req) {
  if (PUSH_PERMISSIONS.includes(req.authorPermission)) {
    return { ok: true, why: `opened by @${req.author}, who has push access` };
  }
  const blessed = (req.approvals ?? []).find((a) => PUSH_PERMISSIONS.includes(a.permission));
  if (blessed) return { ok: true, why: `approved by @${blessed.login} with \`/claude go\`` };
  return { ok: false, why: 'neither opened nor approved with `/claude go` by anyone with push access on this repository' };
}

export const terms = {
  'request-eligible': {
    signals: ['request'],
    holds(signals, { item }) {
      const req = signals.request;
      if (!req) {
        return { error: `this item names no readable request (its \`Request:\` field is ${item?.request ? `#${item.request}` : 'missing'})` };
      }
      if (req.unreadable) return { error: `issue #${req.number} could not be read: ${req.error} — refusing to guess` };
      if (req.gone) return { holds: false, reason: `issue #${req.number} does not exist` };
      if (req.state !== 'open') return { holds: false, reason: `issue #${req.number} was closed before this ran` };
      if (!req.queued) {
        return { holds: false, reason: `issue #${req.number} no longer carries the mark — the request was withdrawn` };
      }
      const verdict = eligibility(req);
      // No `context`: adoption already bound this item to its issue, and a second
      // line saying the same thing renders as two near-identical bullets in the one
      // section the session is told to read as its scope (#1074/#1075).
      return { holds: verdict.ok, reason: `#${req.number}: ${verdict.why}` };
    },
  },
};
