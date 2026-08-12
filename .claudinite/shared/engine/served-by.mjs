// WHICH MECHANISM SERVES THIS REPO — the skew guard for the rollout (#768's first
// risk). In the ENGINE, not in the canon-internal `updates/` tree, because both
// sides must read one definition and one of them is VENDORED: baselining's worker
// runs from a member's own mount, so a guard it could not import would be a guard
// only half the system obeys — which is worse than none. While baselining and the update flows both exist, a repo must be served by
// exactly ONE of them: two mechanisms converging one mount would race on the same
// files, and the loser's write would look like drift the winner then "repairs",
// nightly, forever.
//
// The answer is a per-repo flag, because the transition is per-repo by construction:
// a member moves when the update that migrates it says so, not when the canon does.
//
// DEFAULT IS THE STATUS QUO. A repo that says nothing is served by baselining —
// which is what every member is doing today, so a member that never hears about any
// of this keeps working unchanged. That is the one direction a default may point:
// toward what is already true, never toward the new thing.
//
// …but the default is a READING, not a policy. The corpus's rule is that automation
// maintains the explicit value in every file it maintains, so the flag sits visibly
// in the exact file anyone would go to change it, and a missing key becomes drift the
// automation repairs rather than a case code must interpret forever. `servedBy`
// therefore reports whether the value was DECLARED or inferred: the flip is the
// update's own write, and the inferred case is what tells it there is a write owed.
export const MECHANISMS = ['baselining', 'updates'];
export const DEFAULT_MECHANISM = 'baselining';

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
