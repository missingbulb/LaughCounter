// The 2026-08-19 pack renames (#1022): `core` → `claudinite-lifecycle`, and
// `grow_with_claudinite` → `claudinite-growth`.
//
// This is an ENGINE record and not a pack one, for a structural reason: a pack
// record lives under `packs/<id>/migrations/`, which is precisely the directory
// this change renames — a record placed there would be addressed by an id that no
// longer exists in the canon and would ship to nobody. The engine flow also runs
// BEFORE the pack flow in one converge (the update worker orders them so a pack's
// `minEngineVersion` is judged against the engine the member has just received),
// which is exactly the order this change needs: the declaration is converged onto
// today's spelling first, and the pack flow then reads it and vendors the renamed
// trees under their new names in the same run.
//
// WHAT THIS RECORD IS NOT is the thing that makes the rename safe. Activation
// matches a declared id literally, so any window in which a member's declaration
// and its mount disagree is a window with NO pack — and for the pack carrying the
// `update` task that is unrecoverable, because the machinery that would deliver the
// repair is the machinery that went missing. The tolerance that closes every such
// window is `engine/pack_loader/renamed-packs.mjs`, which resolves both spellings
// at the loader. This record only converges the file so the tolerance can one day
// be retired; nothing depends on it having run.
//
// The mount directory is moved rather than left behind. The pack flow replaces a
// declared pack's tree wholesale but never removes a tree that has stopped being
// declared, so without the alias each member would keep a stale
// `.claudinite/shared/packs/core/` forever — a complete, loadable copy of the old
// pack sitting beside the new one. The move runs in the engine flow, before the
// pack flow vendors the new path, so the canonical side does not exist yet and the
// rename applies; the pack flow then overwrites the moved tree with current content.
export default {
  id: 'pack-renames',
  landed: '2026-08-19',
  version: 5,
  summary: 'packs renamed: core → claudinite-lifecycle, grow_with_claudinite → claudinite-growth (both legacy spellings still resolve at the loader)',

  aliases: [
    { canonical: '.claudinite/shared/packs/claudinite-lifecycle', legacy: ['.claudinite/shared/packs/core'] },
    { canonical: '.claudinite/shared/packs/claudinite-growth', legacy: ['.claudinite/shared/packs/grow_with_claudinite'] },
  ],

  // THE DECLARATION IS NOT THIS RECORD'S ANY MORE. It carried a textual rewrite of
  // the packs array that could not cross a nested array in an entry object, so it
  // converged nothing; the repair is structural and lives in the record beside this
  // one (2026-08-19-pack-renames-declaration, #1041). Removed rather than fixed in
  // place: a member already stamped at this record's version never runs it again, so
  // a fix here would reach only the repos that were never affected.
};
