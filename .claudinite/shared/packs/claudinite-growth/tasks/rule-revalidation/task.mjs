// claudinite-growth task: rule-revalidation — re-probe the pack rules whose
// truth lives OUTSIDE this repo. A rule saying "the harness rejects X", "the
// Action's token cannot reach Y", "MCP tool Z exists" was true of the environment
// on the day it was written, and nothing in the repo goes red when the platform
// moves under it: the prose stays green, sessions keep following it, and the cost
// lands as a session spent on a path that closed months ago. This task re-runs the
// probe behind each such claim and corrects what no longer holds.
//
// Scope is the pack's existing `pack_paths` config — the same key the sibling
// prose-to-checks-sweep reads, so a repo names its capture surface once: a
// consuming repo revalidates only its OWN local packs, and Claudinite (which
// configures `packs`) revalidates the whole canon — so every pack's claims are
// re-probed in the one repo that can fix them, exactly once across the fleet.
//
// Self-contained (imports nothing): the whole contract is this default export.

// The repo's own capture surface — a consumer revalidates only its LOCAL packs.
const DEFAULT_PACK_PATHS = ['.claudinite/local/packs'];

export default {
  id: 'rule-revalidation',
  frequency: 'weekly',             // the environment moves on a platform's clock, not this repo's — see the cadence note
  precondition_signals: [],              // nothing in the repo signals that the world changed; the trigger is the calendar
  agent_model: 'opus',                   // designing a safe probe per claim, and reading a null result correctly, is heavy judgment
  expected_outcome: 'open-pr',           // it rewrites rules sessions obey — reviewed, never auto-merged
  agent_instructions: 'task.md',
  agent_execution_timeout: 2700,         // reading the corpus + running real probes — a generous bound

  // WEEKLY, and with no signal arm at all. Every other growth task waits for the
  // repo to move; this one exists precisely because the repo does NOT move when
  // its claims expire — the harness ships, a token's scope narrows, an MCP server
  // drops a tool, and the only local evidence is a session failing later. So the
  // calendar is the whole trigger, and the slice-per-run discipline in task.md is
  // what keeps a standing corpus affordable.
  precondition(_signals, config) {
    const paths = Array.isArray(config?.pack_paths) && config.pack_paths.length ? config.pack_paths : DEFAULT_PACK_PATHS;
    return {
      run: true,
      reason: `weekly revalidation of environment-dependent claims in ${paths.join(', ')} (no-ops cheaply when every probe still passes)`,
      context: [
        `Pack paths to revalidate (these, and only these): ${paths.join(', ')}.`,
        'Probe read-only. A claim whose probe would write, delete, merge, publish, or notify is verified from authoritative documentation instead — never by performing it.',
        'A probe this session lacks the reach to run is UNPROBED, not disproven: leave the rule exactly as it stands and log it.',
      ],
    };
  },
};
