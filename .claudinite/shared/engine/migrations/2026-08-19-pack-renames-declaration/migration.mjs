// The declaration half of the 2026-08-19 pack renames (#1041), which the record
// beside it (2026-08-19-pack-renames) shipped broken.
//
// That record moved each member's mount directories and its stamped `packVersions`
// keys, and both landed. What it could not do was rewrite the `packs` array: it
// tried textually, anchored on `"packs": [` so a member's own `{ "from": "core" }`
// barrier rule could never be caught by accident, and a real packs array holds entry
// objects with nested arrays (`{ "id": "barriers", "via": ["basics"] }`) that the
// anchor could not cross. Every element after the first such object was invisible to
// it. Measured on the canary: engine, versions and mount all converged, the
// declaration did not.
//
// A SEPARATE RECORD rather than a repair of that one, because a record only applies
// while a repo sits below the version its change took effect at. The canary is
// already stamped 5, so the 5 record can never run there again — and a member that
// converged is exactly the member whose declaration still needs moving.
//
// NOTHING DEPENDS ON THIS HAVING RUN, as with its predecessor: the loader resolves
// both spellings, so a member reads correctly whether or not its declaration has
// been converged. What this buys is the day `renamed-packs.mjs` can be retired,
// which is the only reason to converge a declaration nobody has to read.
export default {
  id: 'pack-renames-declaration',
  landed: '2026-08-19',
  version: 6,
  summary: "the packs array is converged onto each renamed pack's current id (the 2026-08-19-pack-renames record moved the mount and the stamp but not the declaration)",

  // Structural, and the ids come from the engine's rename map rather than from this
  // record — see applyPackRenames in engine/migrations/registry.mjs.
  renameDeclaredPacks: true,
};
