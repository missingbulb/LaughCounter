// The executor's per-task secret selection (tasks-dispatch DESIGN §14).
//
// WHAT THIS MODULE IS FOR NOW: making DESIGN §14.4's claim true. A task's code-work
// gets exactly the names that task declared, selected here, where before every task's
// work step inherited the executor's whole environment and saw every stamped secret.
// That selection is independent of how the secrets arrive, and it is why this module
// survives the reversal below.
//
// THE BAG IS RETIRED (#1336, reversing #1301). The executor briefly carried one static
// line, `CLAUDINITE_SECRETS: ${{ toJSON(secrets) }}`, so the workflow would stop being
// a function of the task set — `.github/workflows/` is the one path a converge cannot
// write, and a new secret therefore needs a human-merged PR in every member, which is
// what wedged one in #1296. But serialising the whole secrets context is the shape
// GitHub's malicious-workflow detection flags: every executor run parked with zero
// jobs until a person clicked Approve, silently, fleet-wide. The owner took the
// trade back — a rare human-merged PR beats a permanent human click on every run.
//
// So the workflow names its secrets again and NOTHING SETS THE BAG. The reader stays
// because members carry the bag-setting workflow until their own PR lands, and reading
// it where present is what makes that window uneventful; `secretValue`'s fallback to
// the plain environment is what makes the reverse window uneventful too. The reader
// comes out on #1642's window rather than on a count of who still stamps a bag —
// the canon cannot take that count.

import { parseBag } from './env-bag.mjs';

export const SECRETS_BAG_ENV = 'CLAUDINITE_SECRETS';

// The parsed bag, or null when this job carries none. A malformed bag is null too:
// the caller's own "declared but not configured" posture then names the secret, which
// is a better answer than a crash inside a JSON parse.
export const secretsBag = (env = process.env) => parseBag(env[SECRETS_BAG_ENV]);

// One secret's value, or undefined.
//
// LEGACY EXECUTOR WORKFLOWS ARE READ AT THE DOOR. A member's live
// `claudinite-executor.yml` moves only through a human-merged PR, so every member
// spends a window running this engine against a workflow that still stamps names
// directly and sets no bag. Reading `env[name]` when the bag does not carry it is
// what makes that window uneventful. The fallback comes out on #1642's window: a
// member's live workflow moves only through a human-merged PR, so the window is what
// that PR is given, and no census of who has merged it is available here.
export function secretValue(name, env = process.env, bag = secretsBag(env)) {
  // The bag holds every secret the repository has, so its own variable is not a
  // secret anyone may ask for by name — otherwise one declaration re-exports all of
  // them and the selection below means nothing.
  if (name === SECRETS_BAG_ENV) return undefined;
  const fromBag = bag?.[name];
  return fromBag === undefined ? env[name] : fromBag;
}

// The declared subset, as an environment fragment: only the names asked for, only the
// ones this job actually carries. A name with no value is left out rather than set to
// an empty string, so a consumer can still tell unset from set-but-empty.
export function secretsFor(names = [], env = process.env) {
  const bag = secretsBag(env);
  const out = {};
  for (const name of names) {
    const value = secretValue(name, env, bag);
    if (value !== undefined) out[name] = value;
  }
  return out;
}
