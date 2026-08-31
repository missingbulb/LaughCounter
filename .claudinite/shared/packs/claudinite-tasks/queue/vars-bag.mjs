// The executor's repository-variable bag (#1492).
//
// WHY THIS EXISTS. Actions requires a workflow to name each value it passes, so
// before this a task needing a repo variable needed the executor workflow to name it —
// and `.github/workflows/` is the one path a converge cannot write, so that meant a
// human-merged PR in every member, the coupling that wedged one in #1296. One static
// line, `CLAUDINITE_VARS: ${{ toJSON(vars) }}`, ends it: the workflow stops being a
// function of what any task declares, and setting a variable in repo settings is the
// whole of adding one.
//
// WHY THE SECRETS BAG CANNOT DO THE SAME. `toJSON(secrets)` is the shape GitHub's
// malicious-workflow detection flags (#1336): the run parks with zero jobs until a
// person clicks Approve, silently and fleet-wide. `vars` is not that shape. It is the
// context GitHub's own docs define as non-sensitive and render UNMASKED in build logs,
// so serialising it exfiltrates nothing the logs do not already show, and the
// static-website pack has passed `toJSON(vars)` in two stub workflows since before that
// safeguard shipped without a single park. GitHub publishes no detection signals, so
// this is inference plus our own field evidence rather than a guarantee; if it is ever
// wrong the symptom is #1336's — `action_required` with zero jobs, which reads exactly
// like an idle queue.

import { parseBag } from './env-bag.mjs';

export const VARS_BAG_ENV = 'CLAUDINITE_VARS';

export const varsBag = (env = process.env) => parseBag(env[VARS_BAG_ENV]);

// The bag as an environment fragment: what a task's code-work should gain, and nothing
// it should lose.
//
// ADDITIVE, NEVER OVERWRITING — the one place this deliberately differs from the
// secrets bag, which wins over a same-named plain variable. That bag replaced named
// lines and is subtracted from the inherited environment before it is applied, so it
// has nothing to collide with. This one is applied ON TOP of a live runner environment
// it does not own, and a repository variable is any name an owner typed into a settings
// box. A repo with a variable called `PATH` or `HOME` must not be able to reach into a
// task subprocess and replace the runner's own; anything already present came from the
// runner or from the workflow, both of which are more specific than "every variable
// this repository happens to define". For a variable the workflow ALSO names, the two
// values come from the same context and are identical, so nothing is lost by yielding.
//
// A missing or malformed bag contributes nothing, which is also the shape of the window
// a member spends between this engine converging and its own executor workflow landing.
export function varsEnv(env = process.env) {
  const bag = varsBag(env);
  if (!bag) return {};
  const out = {};
  for (const [name, value] of Object.entries(bag)) {
    // Otherwise one variable re-exports the whole blob under its own name.
    if (name === VARS_BAG_ENV) continue;
    if (env[name] !== undefined) continue;
    out[name] = value;
  }
  return out;
}
