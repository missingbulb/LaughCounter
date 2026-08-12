// THE ENGINE VERSION — the single number that says which engine release a repo is
// running (docs/versioned-updates/DESIGN.md §2). The engine root vendors wholesale,
// so this module ships into every mount with the rest of the engine, and a member's
// stamp records the value it received (vendoring/apply-vendor-set.mjs). That pair is
// what makes "installed version → target version" answerable on the member side:
// which engine migrations still apply, and whether a pack's minimum is satisfied.
//
// A MONOTONIC INTEGER, not semver. Every comparison the update flows make is
// "installed < target" over a totally ordered sequence — migrations are ranged
// vN→vN+1 — so an integer is the whole requirement, and a three-field string would
// buy a parser plus two components nothing reads.
//
// ADVANCED BY RELEASE, never by an ordinary change: a release is a snapshot that has
// passed the live canary rehearsal once (DESIGN §2.1), and the bump is what declares
// that happened. An engine migration is written against the version it lands in — it
// applies to repos below that number.
export const ENGINE_VERSION = 2;
