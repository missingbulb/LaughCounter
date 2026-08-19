// COMPATIBILITY SHIM — this module is `code-work-run.mjs` now (the 2026-08-18
// phase-language rename, #1012). The path survives for the reason
// `engine-tests/scheduler/engine-pack-lane-shims.test.mjs` sets out in full: the
// engine lane and the pack lane deliver separately, so a member holds the new
// engine beside an old pack for a while, and a fielded `core` pack still imports
// this path from `task-prework-env.mjs`.
//
// WHAT IS HERE. Only the symbols a fielded pack version imports, under the names
// that version spells them. Which those are is derived from history by that test,
// not from a list here.
//
// WHEN IT GOES. When no member's stamped `packVersions` names a `core` version
// that still imports this path — read the field, do not guess a release.
export { CODE_WORK_ENV_VARS as PREWORK_ENV_VARS } from './code-work-run.mjs';
