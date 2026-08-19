import { finding } from '../../engine/checks/helpers/findings.mjs';
import { gatesEveryPull } from './conformance-workflow.mjs';

// A member gates the TREE on every pull request (conformance-workflow, beside
// this) and, until this rule, gated the CHANGE nowhere.
//
// The two scopes answer different questions, and only one of them can see a
// mistake that the tree cannot show. `pack-version-bumped` is the type case: the
// tree always contains a version number, so no whole-repo sweep can tell whether
// THIS change moved it — and canon content edited without that move ships to
// nobody while every check stays green (#939, seven repos frozen for five days).
// Every commit-scoped rule has that shape: an issue reference, a merge commit, a
// contract change that needs a migration.
//
// The work scope ran at the session's Stop hook only, so it was enforced where a
// session happened to be and nowhere else — an unattended commit, a hand-pushed
// branch, or a hook that never fired reached `main` unjudged.
//
// WHAT IT ASKS FOR IS ONE LINE, and deliberately so. Everything that makes the
// sweep meaningful — fetching the base, refusing a scope that would judge
// nothing, and skipping the engine's own `claudinite/…` branches (whose PRs have
// no issue behind them and whose auto-merge is a queue for checks, so a red check
// there stops the repo updating rather than annoying anyone) — lives in the
// vendored entry point. A member carries the invocation, never the recipe, so the
// recipe converges like the rest of the engine.
//
// ADVISORY, for the reason its sibling is: a required thing added to the canon
// with no path for consumers to comply first is the #555 failure. It becomes
// blocking once the fleet carries the step.
//
// RELEVANCE FIRST, twice over: inert in a repo with no mount, and inert in a
// member whose mount predates the entry point — asking for a step that its own
// vendored tree cannot run would be a finding nobody can act on.
const ENTRY = 'engine/checks/ci-work-scope.mjs';
const MOUNT_ENTRY = `.claudinite/shared/${ENTRY}`;
const WORLD_SWEEP = 'engine/checks/check_the_world.mjs';
const WORKFLOW_DIR = '.github/workflows/';

// Does anything in this repo invoke the entry point? Any file, not only a
// workflow: a project may wire its sweeps into a make target, an npm script or a
// justfile, and bootstrap explicitly allows that.
export const invokesEntry = (files, read) => files.some((f) => (read(f) ?? '').includes(ENTRY));

const rule = {
  id: 'conformance-work-scope',
  severity: 'advisory',
  description: 'A member\'s CI runs the work-scope sweep as well as the world sweep',
  doc: 'bootstrap.md',
  why: 'the work scope is the only one that can see what a change did rather than what the repo now contains, and it ran at a session\'s Stop hook or not at all — so a rule about the change was enforced only where a session happened to be',

  run(ctx) {
    if (!ctx.files.includes(MOUNT_ENTRY)) return [];       // no mount, or a mount without the entry point — inert

    // Judged only where the world sweep is already gated on pull requests: a repo
    // with no such gate has conformance-workflow's finding instead, and adding a
    // second one about the same missing workflow would be noise.
    const workflows = ctx.files.filter((f) => f.startsWith(WORKFLOW_DIR) && /\.ya?ml$/.test(f));
    const gate = workflows.find((f) => {
      const text = ctx.read(f);
      if (text === null || !text.includes(WORLD_SWEEP)) return false;
      const { pull, filtered } = gatesEveryPull(text);
      return pull && !filtered;
    });
    if (!gate) return [];

    if (invokesEntry(ctx.files, (f) => ctx.read(f))) return [];

    return [finding(rule, {
      file: gate,
      what: `${gate} gates the tree on every pull request but nothing gates the change — no step runs ${ENTRY}`,
      fix: `add a step beside the world sweep running \`node ${MOUNT_ENTRY} --branch "\${{ github.head_ref || github.ref_name }}"\` `
        + '— it fetches the base branch, skips the engine\'s own claudinite/… branches, refuses a scope that would judge '
        + 'nothing, and fails the build on a blocking finding',
    })];
  },
};

export default rule;
