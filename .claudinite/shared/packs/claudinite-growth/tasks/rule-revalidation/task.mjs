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
export default {
  id: 'rule-revalidation',
  frequency: 'weekly',             // the environment moves on a platform's clock, not this repo's — see the cadence note
  // The claims are about the world, but a repo nobody works in has nothing riding
  // on them: the sweep sleeps while it is silent and resumes on the first active
  // window. Which pack paths it revalidates is task.md's.
  preconditions: ['repo-active'],
  agent_model: 'opus',                   // designing a safe probe per claim, and reading a null result correctly, is heavy judgment
  expected_outcome: 'pr',
  automerge: ['claudinite-local-pack-md-changes'], // rewrites confined to the repo's own local-pack prose land themselves; anything wider parks
  agent_instructions: 'task.md',
  agent_execution_timeout: 2700,         // reading the corpus + running real probes — a generous bound
};
