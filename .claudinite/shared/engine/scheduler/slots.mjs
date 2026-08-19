// COMPATIBILITY SHIM — not a module anything should import today. The calendar
// lives in `calendar.mjs`; this path exists so a member carrying an OLD pack keeps
// loading after the engine has moved on.
//
// WHY IT MUST EXIST. The engine lane and the pack lane deliver in separate PRs on
// separate cycles, and pack delivery is version-gated per pack — so every member
// passes through a window holding the NEW engine beside an OLD pack, and nothing
// can close that window. A pack file importing an engine module is therefore a
// stale caller of an instantly-current engine, the same asymmetry `updates/*`
// already carries ("empty an export, never remove it"). Renaming this module
// without leaving the shim broke exactly that way (#1004): a pack that fails to
// load fails the mount's self-test, the converge then refuses to land AT ALL, and
// the member cannot even receive the pack version that would have fixed it.
//
// WHAT IS HERE. Only what a fielded pack version actually imports — re-exported,
// never re-declared, so the shim cannot drift from the module it stands in for.
// WHICH imports those are is a fact about the versions members are carrying, so it
// is derived from history by `engine-tests/scheduler/engine-pack-lane-shims.test.mjs`
// rather than listed here, where it would go stale silently.
//
// WHEN IT GOES. When no member's stamped `packVersions` names a version that still
// imports this path — read the field, do not guess a release.
export { FREQUENCIES } from './calendar.mjs';
