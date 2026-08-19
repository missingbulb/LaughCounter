// PACKS THAT HAVE BEEN RENAMED — every legacy spelling, mapped straight to today's.
//
// A pack is activated by matching the id a member DECLARED against the id a pack
// module carries, literally. So the moment a canon pack's directory is renamed, every
// member's declaration is one cycle stale by construction, and a member holding the
// old spelling beside the new mount does not get a degraded pack — it gets NO pack,
// because nothing matches. For a pack carrying the `update` task that is terminal:
// the member loses the machinery that would have delivered its own repair, and the
// only route back in is a hand-run against each repo (#1004 is this failure with a
// smaller blast radius).
//
// The declaration rewrite still happens — the migration record converges every
// member onto today's spelling, so this map is a tolerance and not the mechanism.
// What the map buys is that no ORDERING of the two halves can strand anyone: a
// member reads correctly whether its declaration has been rewritten yet or not, and
// whether its mount is ahead of its declaration or behind it.
//
// STRAIGHT TO TODAY'S, never chained. A second rename of an already-renamed pack
// adds its oldest spelling here pointing at the newest name, so a declaration
// written for the very first vocabulary still normalizes in ONE pass — a chain of
// one-step hops would need as many passes as there have been renames, and every
// caller would have to know to loop.
//
// RETIREMENT is read off the fleet, never off a calendar: an entry comes out when
// no member's declaration and no member's stamped `packVersions` still carries that
// spelling. Until then it is load-bearing for exactly the repos that have not
// converged, which are the repos least able to complain.
export const RENAMED_PACKS = Object.freeze({
  core: 'claudinite-lifecycle',
  grow_with_claudinite: 'claudinite-growth',
});

// The canon id a spelling resolves to. Canon packs only — a LOCAL pack lives in the
// member's own tree and its id is that repo's to choose, so a local pack that happens
// to be called `core` is a different pack than the canon one and must not be renamed
// out from under its owner.
export const canonicalPackId = (id) => RENAMED_PACKS[id] ?? id;

// The same map over the keys of a stamp's `packVersions`. A renamed pack whose
// stamped version still sits under the old key reads as version-ABSENT, which is not
// a harmless miss: absent means "never installed", so the install flow claims it,
// stamps it at latest, and runs NO migration records — silently skipping every record
// in the gap the update flow would have applied.
export function canonicalPackVersions(packVersions) {
  if (!packVersions || typeof packVersions !== 'object') return packVersions;
  const out = {};
  for (const [id, version] of Object.entries(packVersions)) {
    const to = canonicalPackId(id);
    // A declaration mid-converge can carry BOTH spellings. Today's wins: it is the
    // one the flows have written, and the legacy key is the residue they replace.
    if (to !== id && Object.hasOwn(packVersions, to)) continue;
    out[to] = version;
  }
  return out;
}
