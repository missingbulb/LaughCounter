// THE ENGINE VERSION — the value that says which engine release a repo is running
// (docs/versioned-updates/DESIGN.md §2). The engine root vendors wholesale, so this
// module ships into every mount with the rest of the engine, and a member's stamp
// records the value it received (vendoring/apply-vendor-set.mjs). That pair is what
// makes "installed version → target version" answerable on the member side: which
// engine migrations still apply, and whether a pack's minimum is satisfied.
//
// DATE-ANCHORED, `<day>.<n>` — the shape, the ordering and why the corpus versions
// this way rather than in semver are stated below the constant. Every comparison made
// of this value is "installed < target" over a total order, so the format buys one
// thing over the plain counter it replaced: the version says when it was cut, without
// a second lookup.
//
// ADVANCED BY RELEASE, never by an ordinary change: a release is a snapshot that has
// passed the live canary rehearsal once (DESIGN §2.1), and the bump is what declares
// that happened. An engine migration is written against the version it lands in — it
// applies to repos below that value.
export const ENGINE_VERSION = '60823.1';

// THE VERSION FORMAT — how every engine and pack version in the corpus is written,
// read and ordered. The helpers below are imported by every side that creates a
// version (each `packs/*/pack.mjs`), stamps one (updates/), compares two (the update
// planners, the dashboard, the fleet roster) or scrapes one out of source text over
// the API. They live beside the constant rather than in a module of their own so the
// engine surface a member's mount must carry for any of it is one file.
//
// THE SHAPE IS `<day>.<n>` — `60820.1`, displayed with a leading `v`. The day part
// is `(year - 2020) * 10000 + month * 100 + day`, so 2026-08-20 is 60820; the second
// part is the running number of versions cut on that day, starting at 1. It is a
// STRING and never a float: `60820.10` and `60820.1` are different versions and the
// same number.
//
// Anchoring the year on 2020 rather than taking its last digit is what keeps the day
// part monotonic past 2029 — 2030 reads 100101, above every 2029 value, where a
// last-digit year would wrap to 0 and sort a decade of releases underneath.
//
// WHY DATE-ANCHORED AT ALL. Every comparison the update flows make is still
// "installed < target" over a total order — nothing here needs semver's three
// components. What the plain counter could not do is say WHEN: a member stamped at 6
// against a canon at 13 is behind by an unknown amount of time, and the fleet
// surfaces that as a number a reader has to go and date by hand.
//
// LEGACY TOLERANCE, until 2026-08-27 (#1106). Versions were plain positive integers
// until 2026-08-20, and the integers are still sitting in every member's stamp, in
// each pack's `minEngineVersion` floor and in every migration record's range. So a
// legacy integer parses here as `<n>.0` — below every date-anchored version, which
// is exactly where a member that has not re-stamped belongs. Dependency-free, like
// the manifest spec it serves.

// The day part of a Date, in UTC. Callers that have a `YYYY-MM-DD` string already
// (the corpus passes `today` around in that form) can hand it straight over.
export function versionDay(when = new Date()) {
  const d = typeof when === 'string' ? new Date(`${when.slice(0, 10)}T00:00:00Z`) : when;
  if (Number.isNaN(d.getTime())) return null;
  return (d.getUTCFullYear() - 2020) * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

// A date-anchored version, as its two parts. The day part is at least five digits
// (2020-01-01 is 101, but nothing predates the scheme, and the smallest day a repo
// can carry is 60820), which is what keeps it unambiguously apart from a legacy
// counter — those never reached three figures.
const DATE_ANCHORED = /^([1-9]\d{4,5})\.([1-9]\d*)$/;

// A version in EITHER form, as `{ day, seq }`, or null when the value is not one.
// A legacy integer is `{ day: n, seq: 0 }` — the same tuple shape, so every
// comparison below is written once and knows nothing about the two spellings.
//
// ZERO IS READABLE and is not an absence: an install runs from version zero
// (docs/versioned-updates/DESIGN.md §3), so a stamp may hold one and it must sort
// below everything rather than read as "this stamp says nothing". Nothing may
// DECLARE it — that is `isDeclaredVersion` below.
export function parseVersion(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? { day: v, seq: 0 } : null;
  if (typeof v !== 'string') return null;
  const m = DATE_ANCHORED.exec(v.trim());
  return m ? { day: Number(m[1]), seq: Number(m[2]) } : null;
}

export const isVersion = (v) => parseVersion(v) !== null;

// What a manifest or a release may WRITE: a real version, never the install floor.
export const isDeclaredVersion = (v) => isVersion(v) && v !== 0;

// True for the retiring spelling only — the one thing the removal change (#1106)
// greps for, and what a reader needing to say "this predates the scheme" asks.
export const isLegacyVersion = (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0;

// Order two versions: negative when `a` is older. An UNPARSEABLE version is not an
// error and not a zero — it sorts as equal to everything, so a caller that cannot
// price one side reports "no gap" rather than inventing one in either direction.
// Callers that must distinguish absence from equality check `isVersion` first.
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  return x.day - y.day || x.seq - y.seq;
}

export const versionAbove = (a, b) => compareVersions(a, b) > 0;

// Equality has to ask more than `compareVersions(a, b) === 0`: an unpriceable side
// compares equal to everything, so the two versions must both be real ones first.
export const versionsEqual = (a, b) => isVersion(a) && isVersion(b) && compareVersions(a, b) === 0;

export const formatVersion = ({ day, seq }) => `${day}.${seq}`;

// The next version to cut today, given the one that stands. A new day restarts the
// running number at 1; a second version on the same day is `.2`. A `current` that is
// legacy, absent or unparseable simply does not constrain today's number — the day
// part is already above every integer the old scheme ever reached.
export function nextVersion(current, today = new Date()) {
  const day = versionDay(today);
  const held = parseVersion(current);
  return held && held.day === day ? `${day}.${held.seq + 1}` : `${day}.1`;
}

// The version-shaped fragment for the text scrapers — the readers that lift a
// version out of `engine/version.mjs` or a `pack.mjs` fetched over the API, where
// there is nothing to import. Kept here so the six of them cannot disagree about
// what a version looks like; each wraps it in its own anchor.
export const VERSION_SOURCE = String.raw`\d+(?:\.\d+)?`;

// What such a scraper should hand back: the literal as it was written, so a legacy
// integer stays a number and a date-anchored version stays a string, and every
// comparison downstream is the same one function.
export function versionFromLiteral(text) {
  if (text == null) return null;
  const t = String(text).trim();
  const v = t.includes('.') ? t : Number(t);
  return isVersion(v) ? v : null;
}
