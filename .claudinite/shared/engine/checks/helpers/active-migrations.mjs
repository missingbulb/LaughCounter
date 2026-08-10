import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// The synchronous migration-registry surface for the CHECK layer. It lives in
// the engine lib — not migrations/ — because pack checks consult it
// (`migrationActive` gates an in-flight transition's legacy tolerance) and a
// pack imports only its own files and the engine surface (pack-independence):
// the canon-internal migrations/ tree is never vendored, so an import into it
// would crash every vendored consumer. Self-locating relative to the engine
// root, so in a vendored consumer — where migrations/ carries only the recent
// vendored records, or nothing — every query answers from what the mount
// actually holds. The full registry (migrations/registry.mjs) builds on this
// same surface canon-side.
//
// One flat home: every migration lives at migrations/<landed-date>-<slug>/,
// with its spec at migration.mjs. All records are equal — there is no
// active/archived split and no cleanup pass; FETCHING decides relevance.
// Vendoring ships only the records landed within RECENT_WINDOW_DAYS, so an
// up-to-date consumer carries few-to-none, while a dormant project baselining
// out of a fresh canon clone sees them all and applies what it needs.
export const MIGRATION_FILE = 'migration.mjs';
export const RECENT_WINDOW_DAYS = 7;
const migrationsRoot = join(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))), 'migrations'); // <canon>/engine/checks/helpers/
const isRecordDir = (name) => /^\d{4}-\d{2}-\d{2}-/.test(name);

// Every migration record folder present, sorted (= chronological: the landed-date
// prefix is the folder-name convention). Tolerant of an absent/empty migrations
// root — a vendored consumer with no recent records.
export function migrationDirs() {
  try {
    return readdirSync(migrationsRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && isRecordDir(e.name) && existsSync(join(migrationsRoot, e.name, MIGRATION_FILE)))
      .map((e) => e.name)
      .sort();
  } catch { return []; }
}

const todayIso = () => new Date().toISOString().slice(0, 10);

// True while a record folder's landed-date prefix is within the recency window —
// the same predicate vendoring uses to decide what ships in a consumer mount,
// so "recent enough to tolerate" and "recent enough to vendor" can never drift.
// Pure over the folder NAME, so vendoring can apply it against its own tree walk.
export function recordDirIsRecent(name, today = todayIso()) {
  const cutoff = new Date(`${today}T00:00:00Z`).getTime() - RECENT_WINDOW_DAYS * 86400000;
  const landedMs = new Date(`${name.slice(0, 10)}T00:00:00Z`).getTime();
  return Number.isFinite(landedMs) && landedMs > cutoff;
}

// True while a migration whose folder name carries `slug` is present AND recent —
// a check consults it to know whether an in-flight transition's legacy shape is
// still tolerated. Recency bounds the tolerance on the canon (where every record
// stays forever) and in a stale mount alike: every up-to-date repo converges
// within the window, and a dormant one is converged by baselining's apply step
// BEFORE its checks run, so an aged record needs no tolerance anywhere.
export function migrationActive(slug, today = todayIso()) {
  return migrationDirs().some((d) => d.includes(slug) && recordDirIsRecent(d, today));
}
