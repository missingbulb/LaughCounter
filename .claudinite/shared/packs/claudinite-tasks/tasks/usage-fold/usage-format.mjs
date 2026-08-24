// The ON-DISK SHAPE of `.claudinite/local/usage.GENERATED.json` — the file this task
// writes, and the only thing that reads it back is this task's next run.
//
// It lives here, beside the fold, because the shape is this task's own business.
// Anything else that consumes the file — a fleet sweep in another repo, an ad-hoc
// query — reads it the way any consumer of a published file does: off the `fields`
// header the file carries, with no code from here. That is the point of declaring
// the vocabulary IN the file rather than in a module a reader would have to import.
//
// WHAT THE SHAPE IS. Every counter row is a positional TUPLE whose field order is
// declared once per file, in that header:
//
//     "fields": { "checks": ["runs", "failures", "errors", "blocking", …] },
//     "checks": { "work": [19, 0, 0, 0, 0, 0, 0] }
//
// rather than a fully-spelled object per row. The names that vary — packs, skills,
// rules, tasks — stay LITERAL KEYS, never dictionary ids: adding or removing one has
// to be nothing but key presence, and week rows freeze forever, so an id table that
// renumbered under them would silently rewrite history.
//
// UNKNOWN IS NOT ZERO. A tuple slot is `null` when that row predates the field (a
// week frozen before a counter existed) — decoding drops the key rather than
// inventing a zero, and the fold's accumulators start it from the first day that
// actually carried it. A row that is short simply has no opinion past its last slot.
//
// READING IS VERSION-TOLERANT. `decodeRow` expands against the FILE's declared
// vocabulary, not this module's, so a file written before a field was added or after
// one was retired still decodes to what it meant. Version 1 — the original
// fully-spelled objects — decodes as itself, which is what lets a fold read back the
// weeks it froze under earlier code without any rollout ordering.
//
// THREE TIERS. Hours (a rolling ~72h of scheduler, executor and agent activity), days
// (recomputed while their raw sources live) and weeks (frozen once). They answer
// different questions on different clocks; see the task's README.

import { TASK_RUN_OUTCOMES, TASK_EXEC_STATUSES, LEGACY_TASK_RUN_OUTCOMES } from '../../../claudinite-tasks/run-record.mjs';

export const USAGE_VERSION = 3;

// The queue's own outcome words — what `outcomeOf`
// (packs/claudinite-tasks/queue/work-item.mjs) decodes a closed work item to, plus `none`
// for one that closed wearing no outcome label at all.
//
// Spelled here rather than imported from the engine, unlike the two task
// vocabularies above it: those symbols are long fielded, while a NEW engine export
// would not be — the engine and this pack land in separate PRs on separate cycles,
// so every member spends a window holding an older engine beside this pack, and a
// pack that fails to load fails the whole mount's self-test. The drift guard is a
// test instead: `fold-usage.test.mjs` drives the real `outcomeOf` over every outcome
// label and fails if this list stops matching what it can return.
export const QUEUE_OUTCOMES = Object.freeze(['done', 'delivered', 'obsolete', 'none']);

// The counter vocabularies, each in the order its tuple spells them. This is the
// single home for those orders: the fold's empty-row builders derive from it, the
// `fields` header is written from it, and appending a field here is the whole change
// (existing rows read short, so they carry `null` for it until they are recomputed).
export const USAGE_FIELDS = Object.freeze({
  // A day row's own scalars. The first five are counted off the capture files and are
  // always present; the rest come from sources that can be absent — see
  // CAPTURE_DAY_FIELDS.
  day: Object.freeze([
    'captures', 'merges', 'sessions', 'userMessages', 'userCommands',
    'ruleTokens', 'ruleTokenSessions',
    'tokensIn', 'tokensOut', 'tokenSessions',
    'commits', 'linesAdded', 'linesRemoved', 'releases',
  ]),
  // A week row's — `days` is how many day rows it absorbed, and `sessionDays` is the
  // sum of the day-level distinct-session counts, which is not a distinct count.
  week: Object.freeze([
    'days', 'captures', 'merges', 'sessionDays', 'userMessages', 'userCommands',
    'ruleTokens', 'ruleTokenSessions',
    'tokensIn', 'tokensOut', 'tokenSessions',
    'commits', 'linesAdded', 'linesRemoved', 'releases',
  ]),
  // An hour row's. `scheduler` and `executor` are workflow runs STARTED in the hour,
  // `agentic` the sessions that captured in it, and `failed` the subset of the two
  // run counts that concluded in failure.
  hour: Object.freeze(['scheduler', 'executor', 'agentic', 'failed']),
  checks: Object.freeze(['runs', 'failures', 'errors', 'blocking', 'advisory', 'ciRuns', 'ciFailures']),
  checkFindings: Object.freeze(['blocking', 'advisory']),
  // Owned by the scheduler, imported rather than re-spelled: the counter keys cannot
  // drift from the outcome words the runs actually emit.
  tasks: TASK_RUN_OUTCOMES,
  taskExec: TASK_EXEC_STATUSES,
  queue: QUEUE_OUTCOMES,
});

// The day fields the capture files themselves answer, and therefore the ones a day row
// always carries a real number for — zero included, because "no session loaded a rule
// that day" is a fact the captures state. Every OTHER day field comes from a source
// that can be absent (a shallow checkout with no history that far back, a releases
// listing that could not be read, a transcript shape carrying no token usage), and an
// absent source must leave NO KEY rather than a zero: `unknown` is a state of its own,
// and a fold that wrote 0 for it would report a busy day as an idle one.
export const CAPTURE_DAY_FIELDS = Object.freeze([
  'captures', 'merges', 'sessions', 'userMessages', 'userCommands', 'ruleTokens', 'ruleTokenSessions',
]);

// The week field each day field folds into. Same name throughout except the two the
// week spells differently, and `days`, which counts rows rather than summing one.
export const WEEK_FROM_DAY = Object.freeze({ sessionDays: 'sessions' });

// The row's sub-maps that carry a counter TUPLE per key. `skillLoads` is deliberately
// not among them — its values are bare numbers, so it needs no vocabulary.
export const COUNTER_GROUPS = Object.freeze(['checks', 'checkFindings', 'tasks', 'taskExec', 'queue']);

const sortKeys = (obj) => Object.fromEntries(Object.keys(obj ?? {}).sort().map((k) => [k, obj[k]]));
const nonEmpty = (obj) => obj !== undefined && obj !== null && Object.keys(obj).length > 0;

// The `fields` header for a file this module's code writes.
export const usageFieldsHeader = () => Object.fromEntries(Object.entries(USAGE_FIELDS).map(([k, v]) => [k, [...v]]));

// One counter row, object → tuple. An absent key becomes `null` (unknown), never 0.
export function encodeCounters(row, fields) {
  return fields.map((f) => (row?.[f] === undefined || row?.[f] === null ? null : row[f]));
}

// …and back. A `null` slot, or a slot past the end of a short tuple, yields NO key —
// the caller's accumulator then starts that field from the first row that has it,
// exactly as it did when the whole group key was missing.
export function decodeCounters(tuple, fields) {
  const row = {};
  fields.forEach((f, i) => {
    const n = Array.isArray(tuple) ? tuple[i] : undefined;
    if (typeof n === 'number') row[f] = n;
  });
  return row;
}

// A whole day/week row, internal (named counters) → on-disk (tuples). `totals` is the
// row's own scalars; the sub-maps follow, and an EMPTY one is omitted entirely rather
// than written as `{}` — zeros are implicit in this file by construction, so an empty
// map carries nothing a reader cannot derive.
export function encodeRow(row, totalsFields) {
  const out = { totals: encodeCounters(row, totalsFields) };
  if (nonEmpty(row.skillLoads)) out.skillLoads = sortKeys(row.skillLoads);
  for (const group of COUNTER_GROUPS) {
    if (!nonEmpty(row[group])) continue;
    const fields = USAGE_FIELDS[group];
    out[group] = Object.fromEntries(
      Object.keys(row[group]).sort().map((k) => [k, encodeCounters(row[group][k], fields)]),
    );
  }
  return out;
}

// On-disk → internal, against the FILE's own declared vocabulary. `fields` is the
// file's `fields` header (missing keys fall back to this module's, which is what a
// hand-written or truncated header gets). Group maps always come back present, empty
// when the row omitted them, because every consumer folds them key-wise.
export function decodeRow(row, totalsFields, fields = {}) {
  const out = { ...decodeCounters(row?.totals, totalsFields), skillLoads: { ...(row?.skillLoads ?? {}) } };
  for (const group of COUNTER_GROUPS) {
    const vocab = fields[group] ?? USAGE_FIELDS[group];
    out[group] = Object.fromEntries(
      Object.entries(row?.[group] ?? {}).map(([k, tuple]) => [k, renameLegacyCounters(group, decodeCounters(tuple, vocab))]),
    );
  }
  return out;
}

// A counter key that has been RENAMED is not a retired field: the count it holds is
// still this row's, under a word the vocabulary no longer spells. Expanding against
// the file's own header gets it back under the old name; this puts it under the new
// one, so the next encode carries it instead of dropping it on the floor. Only the
// `tasks` group has renames — the outcome words, which have moved twice.
function renameLegacyCounters(group, counters) {
  if (group !== 'tasks') return counters;
  const out = {};
  for (const [name, value] of Object.entries(counters)) {
    const canonical = LEGACY_TASK_RUN_OUTCOMES[name] ?? name;
    // Summed, not overwritten: a row can carry both spellings when it was last
    // written across a rename, and both are counts of the same thing.
    out[canonical] = (out[canonical] ?? 0) + (value ?? 0);
  }
  return out;
}

// Is this parsed file already in the tuple shape? Version 1 files — fully-spelled
// counter objects — are read as themselves by both consumers, so the only question a
// reader has to ask is this one.
export const isTupleFormat = (file) => Number(file?.version ?? 1) >= 2;

// The row vocabularies a parsed file declares, defaulted per key. Both readers pass
// the result into `decodeRow`.
export function fieldsOf(file) {
  const declared = file?.fields ?? {};
  return Object.fromEntries(
    Object.keys(USAGE_FIELDS).map((k) => [k, Array.isArray(declared[k]) ? declared[k] : USAGE_FIELDS[k]]),
  );
}

// --- the file as a whole ---------------------------------------------------------
// Three watermarks and three tiers of rows. Both directions live here because the fold
// reads back its OWN prior state every run — the decode is not a compatibility shim,
// it is half of how the task works.

// The key an hour row is filed under: the UTC hour, `YYYY-MM-DDTHH`. Sorts
// chronologically as text, like the day and week keys beside it.
export const hourKey = (iso) => String(iso ?? '').slice(0, 13);

// Named rows → the on-disk file.
export function encodeUsageFile({
  generated = null, foldedThrough = null, runsFoldedThrough = null, queueFoldedThrough = null,
  hours = {}, days = {}, weeks = {},
} = {}) {
  return {
    version: USAGE_VERSION,
    // WHEN THE DATA LAST MOVED, which is not when the file last landed: a quiet repo
    // recomputes to the same numbers and opens no PR, so the commit date can be days
    // older than the last fold that confirmed them. Deliberately excluded from the
    // worker's unchanged-compare for exactly that reason — a stamp that forced a PR
    // every hour would be a stamp nobody could afford.
    generated,
    foldedThrough,
    runsFoldedThrough,
    queueFoldedThrough,
    // The vocabularies this file's tuples are spelled in, written per file so a reader
    // never has to guess which code wrote it.
    fields: usageFieldsHeader(),
    hours: Object.fromEntries(Object.entries(hours).map(([k, v]) => [k, encodeRow(v, USAGE_FIELDS.hour)])),
    days: Object.fromEntries(Object.entries(days).map(([k, v]) => [k, encodeRow(v, USAGE_FIELDS.day)])),
    weeks: Object.fromEntries(Object.entries(weeks).map(([k, v]) => [k, encodeRow(v, USAGE_FIELDS.week)])),
  };
}

// The file's text: ONE LINE PER ROW. `JSON.stringify(file, null, 2)` would put every
// number on its own line, which for tuple rows is nine lines to carry seven numbers
// and a diff that reads per-number instead of per-day. The row is the unit anyone
// reads and the unit the fold rewrites, so it is the unit a line holds.
export function renderUsageFile(file) {
  const rows = (obj) => Object.entries(obj ?? {})
    .map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
  const block = (name, obj, end) => (Object.keys(obj ?? {}).length === 0
    ? [`  ${JSON.stringify(name)}: {}${end}`]
    : [`  ${JSON.stringify(name)}: {`, rows(obj), `  }${end}`]);
  return [
    '{',
    `  "version": ${JSON.stringify(file.version)},`,
    `  "generated": ${JSON.stringify(file.generated ?? null)},`,
    `  "foldedThrough": ${JSON.stringify(file.foldedThrough ?? null)},`,
    `  "runsFoldedThrough": ${JSON.stringify(file.runsFoldedThrough ?? null)},`,
    `  "queueFoldedThrough": ${JSON.stringify(file.queueFoldedThrough ?? null)},`,
    ...block('fields', file.fields, ','),
    ...block('hours', file.hours, ','),
    ...block('days', file.days, ','),
    ...block('weeks', file.weeks, ''),
    '}',
    '',
  ].join('\n');
}

// The one line the unchanged-compare ignores. The stamp moves every run by
// construction, so comparing the rendered text as-is would open a PR an hour on a
// repo where nothing happened — the exact noise the byte-identical check exists to
// prevent. Named here, beside the writer, so the two cannot disagree about which line
// it is.
export const withoutStamp = (text) => String(text ?? '')
  .split('\n').filter((l) => !/^\s*"generated":/.test(l)).join('\n');

// …and back. A version-1 file is already in the named shape and passes through, which
// is what lets a fold read back weeks it froze before this format existed and lets the
// fleet sweep lead its members' upgrades.
export function decodeUsageFile(file) {
  const empty = {
    generated: null, foldedThrough: null, runsFoldedThrough: null, queueFoldedThrough: null,
    hours: {}, days: {}, weeks: {},
  };
  if (!file || typeof file !== 'object') return empty;
  const marks = {
    generated: file.generated ?? null,
    foldedThrough: file.foldedThrough ?? null,
    runsFoldedThrough: file.runsFoldedThrough ?? null,
    // A file written before the queue read existed carries no mark, which reads as
    // "never folded" — the first fold under this code then starts the series from its
    // own lookback rather than claiming to have covered history it never read.
    queueFoldedThrough: file.queueFoldedThrough ?? null,
  };
  if (!isTupleFormat(file)) {
    return { ...marks, hours: {}, days: file.days ?? {}, weeks: file.weeks ?? {} };
  }
  const fields = fieldsOf(file);
  const rows = (map, totals) => Object.fromEntries(
    Object.entries(map ?? {}).map(([k, v]) => [k, decodeRow(v, totals, fields)]),
  );
  return {
    ...marks,
    // A version-2 file has no hours at all; the tier starts empty and fills from the
    // first fold that reads a run listing.
    hours: rows(file.hours, fields.hour),
    days: rows(file.days, fields.day),
    weeks: rows(file.weeks, fields.week),
  };
}
