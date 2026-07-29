// The usage FOLD's counting and folding core (skill-usage-metrics DESIGN §4, §5).
// Every function here is pure and individually tested; worker.mjs is the I/O shell
// that reads the logs branch, calls these, and delivers the result.
//
// The questions this answers, one tested function each:
//   - which skills did a captured session LOAD, and how often;
//   - what workload was that against (captures, merges, sessions, user messages,
//     user commands) — the denominators without which a raw load count cannot
//     distinguish healthy-rare from broken.
//
// Zeros are implicit throughout: a mounted skill with no loads simply has no key.
// The zero set is derived by the consumer, diffing against the repo's mounted
// skills — which is exactly what makes "this skill never loads" visible at all.

// The one non-builtin import: the engine surface a pack may build on
// (pack-independence). "Which skills does this repo mount" has exactly one home —
// the pack registry — and asking it here is what keeps the fold's answer identical
// to what the SessionStart hook actually mounted.
import { loadPacks, isActive, bundledSkillSources } from '../../../../engine/pack_loader/pack-registry.mjs';

// --- entry classification -----------------------------------------------------
// Every shape below was verified against real captured transcripts on a
// conversation-logs branch, not inferred from the harness docs.

// A genuine human turn. POSITIVE test, deliberately: the transcript stamps a
// typed-by-a-person turn with `origin: { kind: 'human' }`, and everything else a
// user-role entry can be — a tool result, an injected/meta turn, a subagent's
// sidechain traffic, a compaction summary, a slash-command expansion, and (the one
// that matters most here) a scheduled-task firing, which carries
// `origin: { kind: 'task-notification', subkind: 'scheduled-trigger' }` — simply
// lacks that stamp. Testing FOR the human marker rather than against a list of
// automated ones means a new automated entry shape is excluded the day it appears
// instead of silently inflating the denominator.
//
// The honest boundary: an older harness wrote no `origin` at all. Those turns count
// as non-human, so a repo's very old captures under-report userMessages rather than
// over-reporting them. This is the most fragile line in the fold, which is why it is
// one function with a fixture per shape it excludes.
export function isUserMessage(entry) {
  return entry?.type === 'user' && entry?.origin?.kind === 'human';
}

// A user-typed slash command. The harness expands `/name args` into a user entry
// whose string content opens with a `<command-name>` tag — the tag is the marker,
// so prose that merely mentions a slash command never counts. Returns the bare
// command name (no leading slash), or null.
const COMMAND_RE = /<command-name>\s*\/?([A-Za-z0-9:_-]+)\s*<\/command-name>/;
export function commandName(entry) {
  if (entry?.type !== 'user') return null;
  const content = entry?.message?.content;
  if (typeof content !== 'string') return null;
  return COMMAND_RE.exec(content)?.[1] ?? null;
}

// Skill names loaded by an assistant entry: every `Skill` tool_use block's
// `input.skill`. Sidechain (subagent) entries are included by the caller — a
// subagent loading a skill is a load.
export function skillToolLoads(entry) {
  if (entry?.type !== 'assistant') return [];
  const content = entry?.message?.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((b) => b?.type === 'tool_use' && b?.name === 'Skill' && typeof b?.input?.skill === 'string')
    .map((b) => b.input.skill);
}

// --- per-file counting ---------------------------------------------------------

// Count one capture file's entries. `mounted` is the set of skill names this repo
// mounts; a typed `/command` counts as a skill load only when it names one of them,
// which is what keeps the built-in CLI commands (`/model`, `/clear`, …) out.
//
// Stated overlap: a typed `/merge-to-main` counts in BOTH userCommands and
// skillLoads. One event, two axes, both true.
export function countEntries(entries, mounted = new Set()) {
  const skillLoads = {};
  let userMessages = 0;
  let userCommands = 0;
  const load = (name) => { skillLoads[name] = (skillLoads[name] ?? 0) + 1; };

  for (const entry of entries) {
    for (const name of skillToolLoads(entry)) load(name);
    if (isUserMessage(entry)) userMessages += 1;
    const command = commandName(entry);
    if (command !== null) {
      userCommands += 1;
      if (mounted.has(command)) load(command);
    }
  }
  return { userMessages, userCommands, skillLoads };
}

// --- day buckets ---------------------------------------------------------------

// An empty day row — the shape every counter folds through.
const emptyDay = () => ({
  captures: 0, merges: 0, sessions: 0, userMessages: 0, userCommands: 0, skillLoads: {},
});

function addLoads(into, from) {
  for (const [name, n] of Object.entries(from)) into[name] = (into[name] ?? 0) + n;
}

// Recompute the day rows from scratch, from the live capture files. `files` is
// `[{ date, issue, sessionId, counts }]` — one entry per capture file in the raw
// window, `counts` being that file's `countEntries` result.
//
// Stateless by construction: a day is a pure function of the files stamped with it,
// so there is no ingest ledger, no double-count risk, and a counting-bug fix
// self-heals the entire visible window on its next run.
export function foldDays(files) {
  const days = {};
  const sessionsByDay = {};
  for (const file of files) {
    const day = (days[file.date] ??= emptyDay());
    day.captures += 1;
    if (file.issue > 0) day.merges += 1;      // issue 0 = a capture with no merge behind it
    day.userMessages += file.counts.userMessages;
    day.userCommands += file.counts.userCommands;
    addLoads(day.skillLoads, file.counts.skillLoads);
    (sessionsByDay[file.date] ??= new Set()).add(file.sessionId);
  }
  // Distinct sessions, not capture count: one session can capture more than once
  // (a merge, then the session-end tail).
  for (const [date, set] of Object.entries(sessionsByDay)) days[date].sessions = set.size;
  return days;
}

// --- week buckets --------------------------------------------------------------

// The ISO-8601 week a UTC date falls in, `YYYY-Www`. ISO weeks start Monday and
// belong to the year containing their Thursday — computed, never approximated,
// because an off-by-one here would silently mis-file a whole week's row.
export function isoWeek(date) {
  const d = new Date(`${date}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;                 // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - day + 3);              // the week's Thursday
  const year = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const offset = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - offset + 3);
  const week = 1 + Math.round((d - firstThursday) / (7 * 86400000));
  return `${year}-W${String(week).padStart(2, '0')}`;
}

// The days to fold into weeks this run: every completed day strictly after the
// watermark and strictly before today, in order. Days close strictly in order, so a
// single monotone watermark is the WHOLE exactly-once mechanism — no ingest ledger.
// `today` is excluded because its capture files are still arriving.
export function daysToFold(days, foldedThrough, today) {
  return Object.keys(days)
    .filter((d) => d < today && (!foldedThrough || d > foldedThrough))
    .sort();
}

// Add one day row into its week row, append-once. Weeks carry `days` — how many day
// rows they absorbed — so a fold outage longer than the raw retention window
// declares its own hole (`days: 5`) instead of silently under-reporting.
//
// `sessionDays` rather than `sessions`: every counter here sums exactly under
// folding EXCEPT a distinct-session count (a session spanning two days is distinct
// in each), so the week-level field is named for what it actually is — the sum of
// the day-level distinct counts — rather than claiming a precision folding cannot
// give.
export function addDayToWeek(week, day) {
  const w = week ?? { days: 0, captures: 0, merges: 0, sessionDays: 0, userMessages: 0, userCommands: 0, skillLoads: {} };
  w.days += 1;
  w.captures += day.captures;
  w.merges += day.merges;
  w.sessionDays += day.sessions;
  w.userMessages += day.userMessages;
  w.userCommands += day.userCommands;
  addLoads(w.skillLoads, day.skillLoads);
  return w;
}

// --- the whole file ------------------------------------------------------------

export const USAGE_VERSION = 1;

// Sorted keys throughout, so a recompute that found nothing new produces a
// byte-identical file and the delivery opens no PR.
function sortKeys(obj) {
  return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));
}

function sortRow(row) {
  return { ...row, skillLoads: sortKeys(row.skillLoads) };
}

// Fold one run: day rows recomputed from `files` (the live raw window), week rows
// carried forward from `prior` and advanced by every day that closed since the
// watermark. Pure — the caller supplies today's UTC date and the prior file.
//
// The two tiers answer different questions and are kept honest by different
// mechanisms: days are cheap to be wrong about (recomputed every run, so a fix
// heals them), weeks are not (frozen once folded — re-freezing would need raw data
// the retention TTL deliberately destroyed), so weeks only ever absorb days that
// have closed and can no longer change.
export function foldUsage({ files, prior = {}, today }) {
  const days = foldDays(files);
  const weeks = structuredClone(prior.weeks ?? {});
  let foldedThrough = prior.foldedThrough ?? null;

  for (const date of daysToFold(days, foldedThrough, today)) {
    const key = isoWeek(date);
    weeks[key] = addDayToWeek(weeks[key], days[date]);
    foldedThrough = date;
  }

  return {
    version: USAGE_VERSION,
    foldedThrough,
    days: sortKeys(Object.fromEntries(Object.entries(days).map(([k, v]) => [k, sortRow(v)]))),
    weeks: sortKeys(Object.fromEntries(Object.entries(weeks).map(([k, v]) => [k, sortRow(v)]))),
  };
}

// --- the mounted-skill set -----------------------------------------------------

// The skill names this repo mounts, from the PACK REGISTRY — never from
// `.claude/skills/`, which is gitignored session state an Action checkout does not
// carry at all. Fails soft to an empty set: with no mounted set, a typed `/command`
// still counts as a userCommand and simply never counts as a skill load.
export async function mountedSkillNames(root, config) {
  try {
    const active = (await loadPacks({ localRoot: root })).filter((p) => isActive(p, config));
    return new Set(bundledSkillSources(active).keys());
  } catch { return new Set(); }
}
