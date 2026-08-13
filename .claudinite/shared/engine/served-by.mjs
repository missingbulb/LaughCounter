// WHICH MECHANISM SERVES THIS REPO — the rollout's skew guard (#768's first risk),
// now the record of a rollout that finished. It began as the flag that kept
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
export const MECHANISMS = ['baselining', 'updates'];
export const DEFAULT_MECHANISM = 'updates';

// The mechanism that no longer exists — kept nameable so the one caller that must
// explain the dead end can name it without hard-coding the string.
export const RETIRED_MECHANISM = 'baselining';

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
export const servedByUpdates = (declaration) => servedBy(declaration).mechanism === 'updates';
export const servedByBaselining = (declaration) => servedBy(declaration).mechanism === 'baselining';

// The declaration a flip writes: the mechanism made explicit, everything else
// untouched. Returned rather than written, so the caller that owns the file owns the
// write — and so this stays testable without one.
export function withMechanism(declaration, mechanism) {
  if (!MECHANISMS.includes(mechanism)) throw new Error(`unknown mechanism "${mechanism}" — one of ${MECHANISMS.join(', ')}`);
  const base = declaration && typeof declaration === 'object' && !Array.isArray(declaration) ? declaration : {};
  return { ...base, [MAINTENANCE]: { ...(base[MAINTENANCE] ?? {}), [MECHANISM_KEY]: mechanism } };
}
