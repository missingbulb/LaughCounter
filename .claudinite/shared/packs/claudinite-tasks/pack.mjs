// claudinite-tasks — the whole scheduled-work surface: the queue, the executor, the
// task contract, and the delivery lane a task's output lands through. What the
// mechanism does, and why it is shaped this way, is the canon's own tasks-dispatch design
// document; how it is wired into a repo is this pack's README.
//
// WHY A PACK AND NOT ENGINE CODE. The engine is what every pack's content needs in
// order to EXIST in a repo — discovery, loading, checks, hooks, the mount. Scheduled
// work is not that: a repo that declares no tasks pack runs no scheduled work, and
// that is a supported state rather than a degraded one. Engine membership is decided
// by extending.md's test — would every pack's content stop working without it? — and
// the queue stopped passing it.
//
// WHAT RIDES ALONG. Queue meta-machinery lives here rather than where it historically
// landed, because its subject is this mechanism and nothing else: `task-janitor`
// (the queue's own sweeps, from basics), `usage-fold` (it folds this mechanism's run
// records and outcome labels, from claudinite-growth), and the two task-declaration
// checks (from claudinite-growth). The simulator and its scenario suite — the
// mechanism's executable spec — are in this pack's own test/.
//
// SHARED-CODE IS THE PUBLISHED SURFACE. `shared-code/` is the one place in the corpus
// another pack's code may import across a pack boundary (the `pack-independence`
// barrier's allow list names it, and nothing else). Everything of this pack outside
// it stays off-limits.
//
// SEEDED AT `--init`, NEVER FINGERPRINTED. A new repo gets scheduled work by default —
// the update task is what keeps its Claudinite current, so a member without a queue is
// one nobody is maintaining — and removing the declaration is a durable opt-out, like
// tidy-repo's. Nothing in a repo's SHAPE implies wanting a queue, so there is no
// fingerprint: a scan that suspected one would suspect it everywhere.
//
// Adoption is still a moment a person is present, because it wires two workflow files
// and the routine endpoints a member cannot converge into place.
export default {
  version: '60827.5',
  minEngineVersion: '60822.1',
  ruleRoutingGuidance: {
    belongs: 'scheduled work — the work-item queue, the executor, the task contract and its signals, run records, code-work, delivery',
    excludes: 'authoring a task — claudinite-growth; this repo\'s Claudinite status — claudinite-lifecycle; rendering queue state — claudinite-dashboard',
  },
  seededByDefault: true,
};
