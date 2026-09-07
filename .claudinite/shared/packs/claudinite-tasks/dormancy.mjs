// Is this project's SCHEDULER dormant? A project goes dormant when it is finished,
// parked, or simply not being worked on: it should stop paying the upkeep of a project
// that IS being worked on.
//
// WHY THIS LIVES IN THIS PACK. Every effect dormancy has is an effect on the queue —
// nothing is instantiated, nothing is picked up, and nothing outside expects movement.
// A repo that declares no tasks pack has no scheduler at all, so the word means nothing
// there, and an engine that validated it for such a repo was answering for a mechanism
// it does not own. So the setting is one of this pack's parameters, declared where the
// pack is:
//
//   { "id": "claudinite-tasks", "config": { "dormant": true } }
//
// What dormancy means, exactly — it is narrow on purpose:
//   - NO RECURRING WORK. The vendored scheduler stops before it evaluates a
//     precondition, so no work item is instantiated, no agent session is started, and
//     no maintenance PR is opened. Nothing scheduled runs "for nothing" on a repo
//     nobody is working on.
//   - NO SCHEDULER CEREMONY FROM OUTSIDE. Whatever looks at this repo from the outside
//     reads the same declaration and does not report a stopped scheduler as unhealthy —
//     a scheduler TOLD to stop must not then be nagged for stopping. It says nothing
//     about the repo's other health: a dormant member whose mount has fallen behind
//     canon is still behind, and is still reported as behind.
//   - EVERYTHING ELSE STAYS ON. Claudinite is not switched off: the session hooks, the
//     checks engine, the mounted skills and pack prose all work exactly as before the
//     moment someone opens a session on the repo. Dormancy is about unattended upkeep,
//     never about what an interactive session may do.
//
// ONE PREDICATE, EVERY SHAPE. It reads a raw parsed .claudinite-settings.json and the
// normalized config `loadConfig` returns, because a cross-repo reader fetches another
// repo's declaration over the API with no engine loaded against that tree and must
// decide dormancy by the same test that repo's own scheduler used. A second notion of
// dormancy would nag exactly the repos that had already opted out.
//
// Import-light and free of `node:` on purpose: the dashboard page reads this in the
// browser through the pack's published shared-code/, and a `node:` import anywhere in
// that graph blocks the page's first module load.
import { RENAMED_PACKS } from '../../engine/pack_loader/renamed-packs.mjs';

// Whose parameter this is. Exported because a reader that has to name the pack to find
// its config should name it from here rather than spell the id a second time.
export const TASKS_PACK_ID = 'claudinite-tasks';

// A declared id as it resolves today. A member's declaration can carry a spelling from
// before a rename, and the config of a pack a member writes into its own repo must keep
// resolving under every spelling it was ever written under.
const resolves = (id) => typeof id === 'string' && (RENAMED_PACKS[id] ?? id) === TASKS_PACK_ID;

// This pack's parameters, from whichever shape the caller holds.
//
// The normalized view first: `loadConfig` folds every entry's `config` into `packConfig`
// keyed by the pack's own id, so a scheduler that already loaded its settings needs no
// second walk. Then the raw declaration, where the parameters sit on the entry object as
// the member wrote them — which is all a cross-repo reader ever has.
function packParameters(config) {
  if (config === null || typeof config !== 'object') return undefined;
  const folded = config.packConfig?.[TASKS_PACK_ID];
  if (folded !== null && typeof folded === 'object') return folded;
  for (const entry of Array.isArray(config.packs) ? config.packs : []) {
    if (entry !== null && typeof entry === 'object' && resolves(entry.id)) return entry.config;
  }
  return undefined;
}

// What the declaration says, before any judgement about whether it says it legally.
// `undefined` means the project never answered, which is the normal shape and means awake.
function declared(config) {
  if (config === null || typeof config !== 'object') return undefined;
  const own = packParameters(config)?.dormant;
  if (own !== undefined) return own;
  // The retired spelling, underneath the pack entry so a converged member is never
  // overridden by a stale key its migration left behind. `raw` is the declaration as
  // the member wrote it, which is where a top-level key survives now that the engine
  // no longer normalizes one it does not own.
  // @legacy-tolerance advisory:legacy-shape-in-use retire:#1846
  return config.raw?.dormant ?? config.dormant;
}

// The predicate. Strictly `=== true`, so every malformed value below reads as awake —
// the conservative direction, since the alternative is silently stopping a project's
// entire scheduled workload on a typo.
export const isDormant = (config) => declared(config) === true;

// The settings errors this parameter can carry, in the `{ what, fix }` shape the world
// runner collects. A string "true", a `{ since }` object or a reason left in its place
// would all read as dormant to a truthiness test and as awake to the predicate above,
// and the difference is a whole repo's scheduled work — so the wrong TYPE is reported
// rather than coerced. The pack owns this because the pack owns the parameter.
export function dormancyErrors(config) {
  const value = declared(config);
  if (value === undefined || typeof value === 'boolean') return [];
  return [{
    what: `"dormant" on the "${TASKS_PACK_ID}" pack entry must be true or false, got ${JSON.stringify(value)}`,
    fix: `set it to true to stop this project's recurring work, or remove it — e.g. { "id": "${TASKS_PACK_ID}", "config": { "dormant": true } }`,
  }];
}
