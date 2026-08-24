// Declare the `claudinite-tasks` pack into every existing member.
//
// WHY A RECORD IS THE ONLY CARRIER. The task surface moved out of the engine into this
// pack (#1317), and a member's two workflow files name its modules by literal path. The
// FILES reach a mount either way while the migration tolerance in the vendor set holds;
// the DECLARATION does not — `resolveDeclaredPacks` materializes a dependency only when
// the declaration is being written, which happens at `--init` and nowhere else in a
// running member, and nothing in the update flows rewrites a member's `packs` list
// (that file also holds its interview answers and every reviewed `accept`). Undeclared,
// the pack would be mounted and inert: `isActive` reads the literal list, so its tasks
// would stop being discovered and the member's queue would go quiet without a red light.
//
// SEED, NEVER OVERRIDE (the `declarePacks` op's contract): a member that already
// declares it keeps its entry untouched, config and all. Idempotent thereafter.
//
// WHO IT APPLIES TO — every member that is RUNNING scheduled work, and only those. A
// repo without the scheduler workflow chose no queue, or never had one, and seeding the
// pack there would hand it tasks nobody asked for. The probe is the member's own
// workflow file, which is the one artifact that cannot be converged into place and so
// says what the repo actually does rather than what a declaration hoped.
//
// THE TOLERANCE THIS RECORD RETIRES. Until every member's stamp carries a
// `claudinite-tasks` version, `vendoring/compute-vendor-set.mjs` ships the pack whether
// or not it is declared, because a mount that dropped the modules its live workflows
// name could not be repaired by any later converge. That tolerance comes out when this
// record has converged fleet-wide — read off the stamps, not off a date.
export default {
  id: 'claudinite-tasks-seed',
  landed: '2026-08-24',
  version: 1,
  summary: 'the claudinite-tasks pack — the work-item queue, the executor, the task contract and the delivery lane — is declared in every member that runs scheduled work',
  appliesTo: async (read) => Boolean(await read('.github/workflows/claudinite-scheduler.yml')),
  declarePacks: [{ id: 'claudinite-tasks' }],
};
