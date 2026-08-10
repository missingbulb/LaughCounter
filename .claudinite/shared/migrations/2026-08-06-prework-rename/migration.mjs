// The 2026-08-06 phase-language rename (per-project-scheduling DESIGN §12):
// task execution is two similar, consecutive phases — deterministic PREWORK,
// then AGENTIC WORK — and the contract fields say so instead of framing the
// code phase as preparation for the agent: `agent_preprocessing` → `prework`,
// `agent_preprocessing_timeout` → `prework_timeout`.
//
// Canon-side the rename is complete (engine, canon packs, canon local packs).
// Member-side, only a member's OWN local packs (.claudinite/local/packs/) can
// carry the legacy names — the vendored mount refreshes with the engine. The
// engine keeps accepting the legacy names (normalized at load, so nothing
// breaks on any clock), and the basics `task-declaration-shape` check flags
// them with the exact rename as the fix — that finding is the durable driver,
// this record only carries the guidance through the fleet's next cycles. A
// member with no local-pack tasks (or none using prework) needs nothing.
export default {
  id: 'prework-rename',
  landed: '2026-08-06',
  summary: 'task contract fields renamed: agent_preprocessing → prework, agent_preprocessing_timeout → prework_timeout (legacy names still accepted, normalized at load)',
  agentic: {
    model: 'haiku',
    instructions: 'If a local pack task (.claudinite/local/packs/<pack>/tasks/<task>/task.mjs) declares `agent_preprocessing` or `agent_preprocessing_timeout`, rename the keys to `prework` and `prework_timeout` (values unchanged) — IN LOCKSTEP with every sibling script and test that reads the old keys off the declaration: grep the task folder and the repo tests for `agent_preprocessing` first, and rename every read in the same commit (a worker reading `decl.agent_preprocessing_timeout` after a task.mjs-only rename gets undefined, and an undefined budget fails silently, not loudly). Then update comments and sibling docs. A member with no such declarations needs nothing.',
  },
};
