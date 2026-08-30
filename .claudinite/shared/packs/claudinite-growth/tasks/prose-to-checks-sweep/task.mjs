// claudinite-growth task: prose-to-checks-sweep — mine a repo's EXISTING pack
// prose for always-testable rules the conversion missed and convert the strongest
// ones (per-project-scheduling redesign). A per-repo task: every repo declaring the
// growth pack sweeps its OWN packs. Which pack paths it works is a config setting,
// `pack_paths`, defaulting to the repo's own local packs; Claudinite itself sets it
// to ALSO include its core `packs/` (projects are not expected to improve core canon
// packs — only Claudinite does). The method is owned by the prose-to-checks skill.
//
// The whole contract is this default export; the only imports are the shared
// constants the local-pack policy scope is built from, never task logic.

// The repo's own capture surface — a consumer improves only its LOCAL packs.
const DEFAULT_PACK_PATHS = ['.claudinite/local/packs'];

import { sep } from 'node:path';
import { LOCAL_PACKS_SUBDIR, LEGACY_LOCAL_PACKS_SUBDIR } from '../../../../engine/pack_loader/pack-registry.mjs';

// The two roots a local pack may sit under during the rename window, as the
// '/'-separated prefixes a policy scope takes (the constants are platform-joined).
const LOCAL_PACK_ROOTS = [LOCAL_PACKS_SUBDIR, LEGACY_LOCAL_PACKS_SUBDIR]
  .map((subdir) => subdir.split(sep).join('/'));

export default {
  id: 'prose-to-checks-sweep',
  frequency: 'weekly',                   // works the STANDING backlog a slice at a time — see the cadence note below
  precondition_signals: [],              // the backlog is standing prose, not a windowed signal
  agent_model: 'opus',                   // judging convertibility and authoring checks + fixtures is heavy judgment
  expected_outcome: 'pr',
  // A conversion removes the prose line and writes the check that replaces it —
  // both classes are this pack's merge-rules.json. In the canon home the sweep
  // works `packs/`, which neither class covers, so a canon round still parks.
  // The prose side is line removals from local-pack Markdown — said inline,
  // since the built-in class already means exactly that; the check side needs
  // the pack's own file-name matcher.
  automerge: [
    ...LOCAL_PACK_ROOTS.map((root) => `under:${root} && markdown-line-removals`),
    'claudinite-local-pack-check-changes',
  ],
  agent_instructions: 'task.md',
  agent_execution_timeout: 2700,         // reading the packs + authoring a check with fixtures — generous bound

  // WEEKLY, not daily. Freshly written prose no longer waits for this task at all:
  // growth-extract runs the prose-to-checks skill over its OWN additions as the last
  // step of every capture run, so a convertible rule is converted the night it is
  // learned. What is left here is the standing backlog — prose that has already
  // survived at least one upgrade pass — and that set changes on a weekly clock, not
  // a daily one. Daily re-read the same dry corpus with an opus dispatch and an
  // owner-gated PR nobody was waiting on.
  precondition(_signals, config) {
    const paths = Array.isArray(config?.pack_paths) && config.pack_paths.length ? config.pack_paths : DEFAULT_PACK_PATHS;
    return {
      run: true,
      reason: `weekly prose-to-checks backlog sweep over ${paths.join(', ')} (no-ops cheaply when dry)`,
      context: [`Pack paths to sweep (work ONLY these; never a read-only mounted canon pack under .claudinite/shared/): ${paths.join(', ')}.`],
    };
  },
};
