// WHAT THIS MOUNT HOLDS — the engine version a repo has installed, and the version
// of each pack it has installed, read out of and written back into its settings
// file. One module, because the update flows, the install flow, the vendor writer
// and the migration selector all ask the same question of the same file, and four
// spellings of "where does the version live" is how a member ends up priced by one
// and converged by another.
//
// WHERE THEY LIVE (#1252). The engine version is the top-level `engineVersion`. A
// pack's version is `version` ON THAT PACK'S OWN ENTRY — the one place it cannot
// outlive what it prices: the central `claudinite.packVersions` map it replaces was
// keyed by a pack id nothing else in the file had to agree with, so a rename left a
// version priced against a pack the declaration no longer named.
//
// THE LEGACY BLOCK IS READ, NEVER WRITTEN. A member reaches the record that reshapes
// its file one converge AFTER the engine that can read the new shape, so every read
// here falls back to `claudinite` and every write leaves it exactly as it found it —
// the reshape is the record's single job, not something four writers do a bit of.
import { canonicalPackVersions } from './pack_loader/renamed-packs.mjs';
// `isVersion`, not `isDeclaredVersion`: the install floor (0) is a real state for a
// version a repo HAS — "below everything" — even though nothing may DECLARE it as a
// manifest's or a release's own number.
import { isVersion } from './version.mjs';

// The retired block. Named so the readers below and the #1252 record agree on the
// one spelling, and so Phase 3 has a symbol to grep for when it deletes the
// tolerance.
// @legacy-tolerance advisory:legacy-shape-in-use retire:#1640
export const LEGACY_STAMP_KEY = 'claudinite';

// `{ engineVersion, packVersions }` for a parsed settings object — the shape every
// caller already passes around as `installed`. Null versions rather than absent
// keys: "not installed" is a state of its own, and a caller comparing against a
// zero or an empty string would read a fresh mount as ancient.
export function installedVersions(raw) {
  const legacy = raw?.[LEGACY_STAMP_KEY] ?? null;
  const engineVersion = isVersion(raw?.engineVersion) ? raw.engineVersion
    : (isVersion(legacy?.engineVersion) ? legacy.engineVersion : null);

  const packVersions = {};
  const legacyPacks = legacy?.packVersions;
  if (legacyPacks && typeof legacyPacks === 'object' && !Array.isArray(legacyPacks)) {
    Object.assign(packVersions, canonicalPackVersions(legacyPacks));
  }
  for (const entry of Array.isArray(raw?.packs) ? raw.packs : []) {
    if (entry && typeof entry === 'object' && typeof entry.id === 'string' && isVersion(entry.version)) {
      packVersions[entry.id] = entry.version;
    }
  }
  return { engineVersion, packVersions };
}

// Has this repo been vendored at all? A mount that has never run stamps neither
// number, and every caller that used to ask "is there a stamp" is asking this.
export const hasInstalledMount = (raw) => {
  const { engineVersion, packVersions } = installedVersions(raw);
  return engineVersion !== null || Object.keys(packVersions).length > 0;
};

// The settings object with these versions recorded: `engineVersion` at the top,
// each pack's version on its own entry. Returned rather than written, so the caller
// that owns the file owns the write — and so this stays testable without one.
//
// A version for a pack the declaration does not carry is DROPPED, not appended as
// a bare entry: an entry is a declaration that the pack is active, and inventing
// one here would activate a pack nobody declared. A pack entry declared as a plain
// string is widened to an object so it can hold its version; every other property
// and the entry ORDER survive untouched, because this file is one a person reads.
export function withInstalledVersions(raw, { engineVersion, packVersions } = {}) {
  const next = { ...(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) };
  if (engineVersion !== undefined && engineVersion !== null) next.engineVersion = engineVersion;

  if (packVersions) {
    next.packs = (Array.isArray(next.packs) ? next.packs : []).map((entry) => {
      const id = typeof entry === 'string' ? entry : entry?.id;
      if (typeof id !== 'string' || !Object.hasOwn(packVersions, id)) return entry;
      const base = typeof entry === 'string' ? { id: entry } : { ...entry };
      // `version` sits directly after `id`, where a reader scanning the list for a
      // pack's version finds it beside the name rather than past its config. The
      // entry's OWN `version` is destructured out before the spread, not merely
      // overwritten by key order: leaving it in `rest` puts the stale number back
      // after the new one and freezes every member at the version it already had.
      const { id: entryId, version: _prior, ...rest } = base;
      return { id: entryId, version: packVersions[id], ...rest };
    });
  }
  return next;
}
