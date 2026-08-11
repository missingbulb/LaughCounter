// The 2026-08-11 fleet-baseline conversion (#749): the sheepdog pack's manual lever
// over the fleet stopped being a standalone WORKFLOW (a managed copy in the enforcer's
// own .github/, the one file the nightly converge could never push — #649) and became
// an ordinary `manual`-frequency TASK (packs/sheepdog/tasks/fleet-baseline/) riding
// the vendored scheduler: Actions → Claudinite scheduler → Run workflow →
// `overrides: FORCE_TASKS=fleet-baseline`.
//
// Canon-side the conversion is complete — the stub the old record materialized
// (packs/sheepdog/stubs/workflows/fleet-baseline.yml) is deleted, which makes the
// 2026-08-05 sheepdog-fleet-baseline record's materialization a permanent no-op (a
// missing template is a skip, never a clobber; see applyMaterializations). What
// remains member-side is the COPY that record installed: an enforcer's own
// .github/workflows/fleet-baseline.yml, now orphaned — its `run:` step points at a
// mount path the vendor refresh no longer carries, so left in place it is a button
// that fails when pressed. Removing a workflow file needs the `workflows` permission
// the Action token does not hold, so the removal rides baselining's agent stage over
// MCP — the same lane that landed the file (#649), run in reverse.
const DECLARATION = '.claudinite-checks.json';
const PACK = 'sheepdog';

export default {
  id: 'fleet-baseline-task',
  landed: '2026-08-11',
  summary: 'fleet-baseline converted from a standalone workflow to a manual-frequency sheepdog task; the enforcer\'s .github/workflows/fleet-baseline.yml copy is retired',

  // Same gate as the record that installed the file: does this repo declare the
  // sheepdog pack. An unreadable declaration means "not an enforcer as far as this
  // record can tell" — skip, never guess.
  appliesTo: async (read) => {
    const text = await read(DECLARATION);
    if (!text) return false;
    let cfg;
    try { cfg = JSON.parse(text); } catch { return false; }
    return (Array.isArray(cfg?.packs) ? cfg.packs : [])
      .some((e) => (typeof e === 'string' ? e : e?.id) === PACK);
  },

  agentic: {
    model: 'haiku',
    instructions: 'If this repo has a tracked .github/workflows/fleet-baseline.yml, delete it (git rm) on the maintenance branch — the fleet-baseline lever is now the sheepdog pack\'s manual-frequency task (run the Claudinite scheduler workflow by hand with overrides FORCE_TASKS=fleet-baseline), and the old workflow points at mount paths the vendor refresh no longer carries, so it is a button that fails when pressed. Do not touch claudinite-scheduler.yml. A repo with no such file needs nothing.',
  },

  legacyPresent: async (exists) => exists('.github/workflows/fleet-baseline.yml'),
};
