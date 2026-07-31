import { finding } from '../../engine/checks/helpers/findings.mjs';

// A member must have SOMETHING in CI that runs the world sweep on every pull
// request — otherwise its own conformance is never gated, and (worse) its
// nightly maintenance PR can never land.
//
// WHY THIS IS ITS OWN RULE. `maintenance.delivery: auto-merge` arms GitHub's
// auto-merge, which is a queue for CHECKS. Three shapes exist, and only one
// works:
//
//   no pull_request workflow at all  → baselining merges directly (#588). Fine.
//   an UNFILTERED conformance flow   → the sweep runs, auto-merge lands on green.
//   a PATH-FILTERED flow             → the arm succeeds, and no check ever runs.
//                                      The PR waits forever. THIS is the trap.
//
// The third shape is invisible: the repo looks like it has CI, `hasPrCi` is
// true, the arm reports success, and the PR simply never lands. TLDR sat in it —
// all three of its test workflows filter to `extension/**`, `server/**`,
// `dev/requirements/**`, so a maintenance PR touching only `.claudinite/**`
// matched nothing. The same filters also hid two blocking `claudinite-isolation`
// findings on its `main` for as long as they had existed.
//
// ADVISORY, DELIBERATELY. Shipping this blocking would turn every member that
// lacks the workflow red on its very next baselining — which is precisely the
// #555 failure this rule exists to make less likely (a required thing added to
// the canon with no path for consumers to comply first). It becomes blocking
// once the fleet carries the workflow; the promotion is a one-line change here.
//
// RELEVANCE FIRST (engine/checks/README.md): gate on the vendored mount, so this
// is inert in any repo that is not a Claudinite member.
const SWEEP = 'engine/checks/check_the_world.mjs';
const MOUNT = '.claudinite/shared/engine/checks/check_the_world.mjs';
const WORKFLOW_DIR = '.github/workflows/';

// The `on:` block alone — from the `on:` key to the next top-level key. Trigger
// filters (`paths:`) are nested INSIDE it, so scanning the whole file would
// confuse a job-level key with a trigger-level one.
export function onBlock(text) {
  const start = text.search(/^on:/m);
  if (start < 0) return '';
  const rest = text.slice(start).split('\n');
  const out = [rest[0]];
  for (const line of rest.slice(1)) {
    if (/^[A-Za-z_-]+:/.test(line)) break; // next top-level key
    out.push(line);
  }
  return out.join('\n');
}

// Does this workflow run the world sweep on EVERY pull request? Both halves
// matter: a sweep behind a path filter is not a gate, it is a gate that happens
// to be open.
export function gatesEveryPull(text) {
  const on = onBlock(text);
  if (!/^\s+pull_request:/m.test(on)) return { pull: false, filtered: false, sweeps: false };
  // The pull_request sub-block: its own indented lines, up to the next trigger.
  const lines = on.split('\n');
  const at = lines.findIndex((l) => /^\s+pull_request:/.test(l));
  const indent = lines[at].search(/\S/);
  const body = [];
  for (const line of lines.slice(at + 1)) {
    if (line.trim() && line.search(/\S/) <= indent) break;
    body.push(line);
  }
  return {
    pull: true,
    filtered: /^\s*paths(-ignore)?:/m.test(body.join('\n')),
    sweeps: text.includes(SWEEP),
  };
}

const rule = {
  id: 'conformance-workflow',
  severity: 'advisory',
  description: 'A member has a workflow running check_the_world on every pull request, with no path filter',
  doc: 'packs/basics/scheduled-tasks.md',
  why: 'auto-merge is a queue for checks — a path-filtered conformance flow arms successfully and then never runs, so the nightly maintenance PR waits forever and the repo silently stops baselining',

  run(ctx) {
    if (!ctx.files.includes(MOUNT)) return [];  // not a member — inert
    const workflows = ctx.files.filter((f) => f.startsWith(WORKFLOW_DIR) && /\.ya?ml$/.test(f));

    const filtered = [];
    for (const file of workflows) {
      const text = ctx.read(file);
      if (text === null) continue;
      const { pull, filtered: hasFilter, sweeps } = gatesEveryPull(text);
      if (!pull || !sweeps) continue;
      if (!hasFilter) return [];              // a real gate exists — done
      filtered.push(file);
    }

    // A repo with NO pull_request workflow at all is not flagged: baselining
    // merges its maintenance PR directly (#588), which is a coherent shape. The
    // finding is for the trap — a sweep that exists but cannot run.
    if (!filtered.length && !workflows.some((f) => /^\s+pull_request:/m.test(ctx.read(f) ?? ''))) return [];

    return [finding(rule, {
      file: filtered[0] ?? WORKFLOW_DIR,
      what: filtered.length
        ? `${filtered[0]} runs the world sweep on pull_request but behind a path filter, so a maintenance PR touching only .claudinite/** starts no check`
        : 'this repo has pull_request workflows but none of them runs the world sweep, so its conformance is never gated on a PR',
      fix: 'add a conformance workflow triggered on `pull_request` with NO `paths:` filter (plus `workflow_dispatch:` so baselining can start it) running '
        + '`node .claudinite/shared/engine/checks/check_the_world.mjs` — or drop the path filter from the workflow that already runs it',
    })];
  },
};

export default rule;
