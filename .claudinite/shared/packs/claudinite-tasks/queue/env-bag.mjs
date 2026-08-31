// The parse both of the executor's bags share.
//
// The executor hands its job's contexts to task code as JSON in a single environment
// variable — one bag for `secrets` (secrets-bag.mjs), one for `vars` (vars-bag.mjs).
// What the two do with a parsed bag differs sharply, which is why they are separate
// modules; how a bag is READ does not, which is why that part lives here rather than
// twice.

// A bag's contents, or null when this job carries none. A malformed bag is null too:
// every caller already has a "this job carries no bag" path, and that path is a better
// answer than a crash inside a JSON parse.
export function parseBag(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}
