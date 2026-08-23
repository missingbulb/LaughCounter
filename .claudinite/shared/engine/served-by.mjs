// @deprecated (#1252) — WHICH MECHANISM SERVES THIS REPO. Nothing in the corpus
// calls this any more: the `maintenance` block it reads is retired, and with the
// rival mechanism deleted in #768 Phase 5 the question had one possible answer for
// every member that could still ask it.
//
// KEPT CALLABLE, not deleted, for the reason every `updates/*` export is: a member's
// VENDORED worker is a cycle behind the flows that rewrote its declaration, so a
// removal would wedge every member holding the old copy on its next run. Its answers
// stay correct for those callers by construction — a member whose block the rename
// record has removed reads as the default, which is `versioned`, which is what it
// is. Retire it by reading the field: the condition is that no member's vendored
// worker imports it.
//
// Below is what it was: the rollout's skew guard (#768's first risk), and then the
// record of a rollout that finished. It began as the flag that kept
// baselining and the update flows from converging one mount at once: two mechanisms
// writing the same files would race, and the loser's write would look like drift the
// winner then "repairs", nightly, forever.
//
// PHASE 5 RETIRED BASELINING, so there is no longer a second mechanism to skew
// against, and the default moves with the fact: a repo that says nothing is served by
// `updates`, because that is now the only thing any repo can be served by. The rule
// the old default obeyed is the same rule that moves it — a default may only point at
// what is already true.
//
// `baselining` REMAINS A RECOGNISED VALUE, deliberately. A declaration still saying
// it is a real thing in the world (a repo whose mount predates the flip, restored
// from a backup, or hand-edited), and reading it as anything other than what it says
// would hand that repo to a mechanism its owner did not choose. So it still parses,
// still reports `declared: true`, and the flows still stand down for it — but what it
// names no longer exists, so a repo declaring it gets NOTHING and must be told so
// loudly rather than served silently.
//
// The default is a READING, not a policy. The corpus's rule is that automation
// maintains the explicit value in every file it maintains, so the flag sits visibly
// in the exact file anyone would go to change it, and a missing key becomes drift the
// automation repairs rather than a case code must interpret forever. `servedBy`
// therefore reports whether the value was DECLARED or inferred.
// THE NAME IS `versioned`, and `updates` is its own legacy alias.
//
// The mechanism and the TASK that runs it had names one letter apart — mechanism
// `updates`, task `update` — which is not a style complaint: the two appear together
// in the same sentences, in `FORCE_TASKS=update` beside `mechanism: "updates"`, and a
// reader with no way to tell which noun they are looking at will eventually type the
// wrong one. The mechanism is renamed rather than the task because the mechanism is
// what the design already calls this thing everywhere else — "versioned updates"
// (docs/versioned-updates/DESIGN.md) — while `update` is the right name for a task,
// which is an action a repo performs.
//
// `updates` STAYS RECOGNISED for the same reason `baselining` does, and for a
// narrower window: it is stamped in every member's declaration right now, and a
// member reads its own declaration with the engine it currently has, which is one
// cycle behind the record that renames it. A member converging mid-rename must not
// find its own mechanism unrecognised — that reads as `invalid`, which resolves to
// the default with the offending value attached, and would make a correctly-declared
// repo look misdeclared for exactly one cycle. The `basics` record retires it from
// declarations; this list retires it from the vocabulary a release later.
export const MECHANISMS = ['baselining', 'updates', 'versioned'];
export const DEFAULT_MECHANISM = 'versioned';

// The mechanism that no longer exists — kept nameable so the one caller that must
// explain the dead end can name it without hard-coding the string.
export const RETIRED_MECHANISM = 'baselining';

// …and the one being renamed out of declarations, still fully served while members
// carry it. Distinct from RETIRED: a repo declaring this gets maintained normally,
// it is simply spelled the old way.
export const LEGACY_MECHANISM = 'updates';
export const VERSIONED_MECHANISM = 'versioned';

// The declaration key. Beside `delivery`, because both answer "how is this repo
// maintained" and a second home for the same question is how a repo ends up
// answering it twice, differently.
export const MAINTENANCE = 'maintenance';
export const MECHANISM_KEY = 'mechanism';

// `{ mechanism, declared }` — the mechanism to run, and whether the repo actually
// said so. An unrecognised value is NOT silently treated as the default: it is the
// one case where guessing could hand a repo to the wrong mechanism, so it reports
// itself as undeclared with the offending value attached, and a caller that cares
// stops rather than picking.
export function servedBy(declaration) {
  const raw = declaration?.[MAINTENANCE]?.[MECHANISM_KEY];
  if (raw === undefined || raw === null) return { mechanism: DEFAULT_MECHANISM, declared: false };
  if (typeof raw !== 'string' || !MECHANISMS.includes(raw)) {
    return { mechanism: DEFAULT_MECHANISM, declared: false, invalid: raw };
  }
  return { mechanism: raw, declared: true };
}

// The two questions the mechanisms ask about themselves, so neither has to know the
// other's name at its call site — and so the "exactly one" property is one
// expression rather than two that can disagree.
// Both spellings answer yes: a member on the old name is served by the same flows,
// so every caller asking "are the update flows mine to run" gets one answer whichever
// word the repo happens to carry this cycle.
export const servedByUpdates = (declaration) =>
  [LEGACY_MECHANISM, VERSIONED_MECHANISM].includes(servedBy(declaration).mechanism);
export const servedByBaselining = (declaration) => servedBy(declaration).mechanism === RETIRED_MECHANISM;

// The declaration a flip writes: the mechanism made explicit, everything else
// untouched. Returned rather than written, so the caller that owns the file owns the
// write — and so this stays testable without one.
export function withMechanism(declaration, mechanism) {
  if (!MECHANISMS.includes(mechanism)) throw new Error(`unknown mechanism "${mechanism}" — one of ${MECHANISMS.join(', ')}`);
  const base = declaration && typeof declaration === 'object' && !Array.isArray(declaration) ? declaration : {};
  return { ...base, [MAINTENANCE]: { ...(base[MAINTENANCE] ?? {}), [MECHANISM_KEY]: mechanism } };
}
