import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalPackVersions } from '../../pack_loader/renamed-packs.mjs';

// The synchronous migration-registry surface for the CHECK layer. It lives in
// the engine lib because pack checks consult it (`migrationActive` gates an
// in-flight transition's legacy tolerance) and a pack imports only its own files
// and the engine surface (pack-independence). Self-locating relative to the
// engine root, so in a vendored consumer — where a mount carries only the recent
// vendored records, or none — every query answers from what the mount actually
// holds. The full registry (engine/migrations/registry.mjs) builds on this same
// surface canon-side.
//
// TWO HOMES, ONE SHAPE. A record belongs to the flow that owns it: an engine
// migration lives at `engine/migrations/<landed-date>-<slug>/`, a pack's at
// `packs/<pack>/migrations/<landed-date>-<slug>/`, each with its spec at
// migration.mjs (docs/versioned-updates/DESIGN.md §3.7). Discovery walks both,
// so a caller never has to know which flow raised a record — and the split is
// what lets each flow fetch, and later version-range, only its own.
//
// All records are equal — there is no active/archived split and no cleanup pass;
// FETCHING decides relevance. Vendoring ships only the records landed within
// RECENT_WINDOW_DAYS, so an up-to-date consumer carries few-to-none, while a
// lagging project updating out of a fresh canon clone sees them all and
// applies what it needs.
export const MIGRATION_FILE = 'migration.mjs';
export const RECENT_WINDOW_DAYS = 7;
export const MIGRATIONS_SUBDIR = 'migrations';

// <corpus>/engine/checks/helpers/ — the corpus root is this file's fourth parent:
// the canon repo root canon-side, the mount root (.claudinite/shared/) in a member.
const corpusRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

const isRecordDir = (name) => /^\d{4}-\d{2}-\d{2}-/.test(name);
const subdirs = (dir) => {
  try { return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); }
  catch { return []; }
};

// Every directory that may hold records, corpus-relative: the engine's own, and
// one per pack present. Derived from the tree rather than a list, so a pack that
// grows its first record needs no registration anywhere.
export function migrationRoots() {
  return [
    `engine/${MIGRATIONS_SUBDIR}`,
    ...subdirs(join(corpusRoot, 'packs')).sort().map((p) => `packs/${p}/${MIGRATIONS_SUBDIR}`),
  ];
}

// Every migration record present, as CORPUS-RELATIVE paths
// (`engine/migrations/2026-08-06-prework-rename`), sorted by landed date so the
// set reads chronologically across both homes. Tolerant of absent roots — a
// vendored consumer with no recent records, or a pack that has never needed one.
export function migrationDirs() {
  const found = [];
  for (const root of migrationRoots()) {
    for (const name of subdirs(join(corpusRoot, root))) {
      if (isRecordDir(name) && existsSync(join(corpusRoot, root, name, MIGRATION_FILE))) found.push(`${root}/${name}`);
    }
  }
  // By record name first — the landed-date prefix — so ordering is the canon's
  // history, not the alphabet of the directories the records happen to live in.
  return found.sort((a, b) => basename(a).localeCompare(basename(b)) || a.localeCompare(b));
}

// The record folder NAME of a discovered path — what the date prefix and the slug
// live on. Callers hold paths; every predicate below judges the name.
export const recordName = (dirOrPath) => basename(dirOrPath);

const todayIso = () => new Date().toISOString().slice(0, 10);

// True while a record folder's landed-date prefix is within the recency window —
// the same predicate vendoring uses to decide what ships in a consumer mount,
// so "recent enough to tolerate" and "recent enough to vendor" can never drift.
// Pure over the folder name (a bare name or a path ending in one), so vendoring
// can apply it against its own tree walk.
export function recordDirIsRecent(name, today = todayIso()) {
  const cutoff = new Date(`${today}T00:00:00Z`).getTime() - RECENT_WINDOW_DAYS * 86400000;
  const landedMs = new Date(`${recordName(name).slice(0, 10)}T00:00:00Z`).getTime();
  return Number.isFinite(landedMs) && landedMs > cutoff;
}

// The flow a record belongs to, read off WHERE IT LIVES — the structural
// classifier the split already gives us, so no record carries a field saying
// which flow it is (and none can carry the wrong one).
export function flowOf(dirPath) {
  const parts = dirPath.split('/');
  if (parts[0] === 'packs' && parts.length > 2) return { flow: 'pack', pack: parts[1] };
  return { flow: 'engine' };
}

// The version a record declares — the version of its owning flow AT WHICH ITS
// CHANGE IS IN EFFECT, so a repo below that number has not yet received the
// change and still needs the record. A record therefore lands in the same change
// as the bump it names (engine/RELEASES.md states the release discipline).
//
// READ BY REGEX, not by importing the spec, because every caller here is
// SYNCHRONOUS — `migrationActive` is called from inside check bodies, and making
// it async would ripple through every rule in the corpus. The cost is that the
// field must be a plain literal on its own line; the price of that constraint is
// paid by one drift-guard test which imports every real record and asserts the
// regex agrees with the module (engine-tests/migrations.test.mjs), so the two
// readings of the same fact cannot diverge unnoticed.
const VERSION_FIELD = /^\s*version:\s*(\d+)\s*,\s*$/m;
export function recordVersion(dirPath) {
  let src;
  try { src = readFileSync(join(corpusRoot, dirPath, MIGRATION_FILE), 'utf8'); } catch { return null; }
  const m = VERSION_FIELD.exec(src);
  return m ? Number(m[1]) : null;
}

// The repo the corpus is mounted in: the canon IS its own repo root, while a
// member's corpus sits at <repo>/.claudinite/shared. Both roots, one expression —
// the shape the corpus insists on for anything that runs in either place.
const repoRoot = corpusRoot.endsWith(join('.claudinite', 'shared'))
  ? dirname(dirname(corpusRoot))
  : corpusRoot;

// The versions this repo has INSTALLED, off its own stamp, or null when it has
// none. Null is a real answer and not a zero: a repo that has never converged
// under the versioned scheme (and the canon, which is not a member and carries no
// stamp) is *unknown*, which the predicate below answers by date instead of by
// pretending the repo is at version 0.
export function installedVersions(read = () => { try { return readFileSync(join(repoRoot, DECLARATION_FILE), 'utf8'); } catch { return null; } }) {
  const raw = read();
  if (raw == null) return null;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }
  const stamp = parsed?.claudinite;
  if (!stamp || typeof stamp !== 'object') return null;
  const { engineVersion = null, packVersions = null } = stamp;
  if (engineVersion === null && packVersions === null) return null;
  // Keys canonicalized on the way out, for the same reason declared ids are: a
  // version stamped under a pack's old spelling must not read as "never installed".
  return { engineVersion, packVersions: canonicalPackVersions(packVersions ?? {}) };
}
export const DECLARATION_FILE = '.claudinite-checks.json';

// What this repo has installed of the flow that owns `dirPath` — undefined when
// the stamp says nothing about that flow (an unversioned pack, a stamp predating
// the scheme). Kept distinct from a real number all the way down.
export function installedFor(dirPath, installed) {
  if (!installed) return undefined;
  const of = flowOf(dirPath);
  const v = of.flow === 'engine' ? installed.engineVersion : installed.packVersions?.[of.pack];
  return typeof v === 'number' ? v : undefined;
}

// THE ONE PREDICATE: does this record still apply to a repo in this state?
//
// Version-ranged when both numbers are known — a record applies exactly while the
// repo sits BELOW the version its change took effect at, so an up-to-date repo
// matches none and a lagging one matches exactly its gap. That is what vendoring
// fetches by and what check-tolerance tolerates by, one function, so "shipped to
// the mount" and "tolerated by a check" can never mean different things.
//
// Falls back to the landed-date window when either number is unknown: a repo that
// has not converged since versions existed, and the canon itself, which carries no
// stamp and is nobody's member. Unknown is answered as unknown — never as zero,
// which would make every record apply to everything, forever.
export function migrationApplies(dirPath, { installed = null, today = todayIso() } = {}) {
  const have = installedFor(dirPath, installed);
  const want = recordVersion(dirPath);
  if (have === undefined || want === null) return recordDirIsRecent(dirPath, today);
  return want > have;
}

// True while a migration whose folder name carries `slug` still applies to THIS
// repo — a check consults it to know whether an in-flight transition's legacy
// shape is still tolerated. It reads the same predicate vendoring fetched by, so
// in a member the answer reduces to "is the record in my mount": the gate that
// put it there and the gate that tolerates it are the same one.
export function migrationActive(slug, today = todayIso()) {
  const installed = installedVersions();
  return migrationDirs().some((d) => recordName(d).includes(slug) && migrationApplies(d, { installed, today }));
}
