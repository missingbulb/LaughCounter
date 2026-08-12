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
  version: 1,
  summary: 'task contract fields renamed: agent_preprocessing → prework, agent_preprocessing_timeout → prework_timeout (legacy names still accepted, normalized at load)',
  // The agentic note this record carried is RETIRED (#768 Phase 4), and the record's
  // own reasoning is why: the note only ever "carried the guidance through the fleet's
  // next cycles" — the DURABLE driver is the `task-declaration-shape` finding, which
  // names the exact rename and does not age out. Nothing is lost by dropping it and
  // one thing is gained: this was the last ENGINE record carrying a note, and an
  // engine record with one stops the engine update flow dead for any repo whose gap
  // contains it (DESIGN §5 admits no agentic stage there).
  //
  // The rollout had already dismantled the channel underneath it. Measured on the
  // canary, 2026-08-12: the first update-flow cycle deleted this record from that
  // member's mount — the version gate says a repo at engine 2 does not need a record
  // whose change took effect at 1 — while `claudinite.updated`, the field that held
  // the stamp for this note, is never written by the update flows at all. So on any
  // flipped repo the note was already unreachable; keeping it only held the stamp of
  // repos still on baselining, for work their own conformance check already reports.
};
