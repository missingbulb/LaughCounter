import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { parseEntries } from './session-transcript.mjs';
import { SHARED_SUBDIR, packEntryId } from '../../pack_loader/pack-registry.mjs';

function sh(root, cmd, args, { allowFail = false, input = undefined, timeout = undefined } = {}) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, input, timeout });
  if (r.status !== 0 && !allowFail) {
    throw new Error(`${cmd} ${args.join(' ')} failed (${r.status}): ${r.stderr}`);
  }
  return r.status === 0 ? r.stdout : null;
}

const git = (root, ...args) => sh(root, 'git', args);
const gitTry = (root, ...args) => sh(root, 'git', args, { allowFail: true });

// The base branch this repo's work is judged against, in preference order.
// Exported because the CI entry point (../ci-work-scope.mjs) fetches these same
// refs before a context is built at all — one list, so what CI fetches and what a
// context resolves can never name different branches.
export const BASE_REF_CANDIDATES = ['origin/main', 'origin/master', 'main', 'master'];

function resolveBaseRef(root) {
  for (const ref of BASE_REF_CANDIDATES) {
    if (gitTry(root, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`) !== null) return ref;
  }
  return null;
}

const FETCH_TIMEOUT_MS = 8000;
const FETCH_WINDOW_MS = 5 * 60_000;

// A remote-tracking base ref is only as fresh as the last fetch, and a cloud session's
// clone freezes it at container-creation time — so every commit the base branch gained
// since lands inside `mergeBase..HEAD` and gets billed to the work. That is a wrong
// verdict, not a stale one: the delta rules (squash-merge-history above all, a *blocking*
// rule) report other people's commits as introduced by this change, and `--changed`
// widens to files the change never touched. Refreshing the ref once per run is what makes
// "the work" mean the work.
//
// Best-effort by construction — no network, no remote, a lock held, a slow server: the
// fetch fails or times out and the run continues against the ref as it stands, exactly as
// before this existed. It writes ONLY the remote-tracking ref (explicit refspec, no tags):
// no local branch, no index, no working tree, nothing the session could be surprised by.
// Set CLAUDINITE_CHECKS_NO_FETCH=1 to skip it (sealed sandboxes, or to pin a base).
//
// And it runs once per freshness window, not once per run: the Stop hook builds a context
// every turn with tracked changes, and the fetch is that path's dominant wall-clock cost
// (~0.7s healthy, 8s timeout when the network is not). A marker in the git dir records
// which ref was refreshed and when; a run inside the window trusts it and skips. The
// marker is PER-REF on purpose — a fetch of some other ref (or a marker left by one) says
// nothing about this base's freshness — and the staleness the window admits is the same
// class the fetch's own failure tolerance already accepts, now bounded by the window.
function refreshBaseRef(root, ref) {
  if (!ref || process.env.CLAUDINITE_CHECKS_NO_FETCH === '1') return;
  const m = /^([^/]+)\/(.+)$/.exec(ref);
  if (!m) return; // a local branch is already as current as the checkout — nothing to fetch
  const markerRel = (gitTry(root, 'rev-parse', '--git-path', 'claudinite-base-refresh.json') || '').trim();
  const marker = markerRel ? resolve(root, markerRel) : null;
  if (marker) {
    try {
      const last = JSON.parse(readFileSync(marker, 'utf8'));
      if (last.ref === ref && Date.now() - last.at < FETCH_WINDOW_MS) return;
    } catch { /* no marker (or an unreadable one) means no known freshness — fetch */ }
  }
  const [, remote, branch] = m;
  const fetched = sh(root, 'git', ['fetch', '--quiet', '--no-tags', remote,
    `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`],
  { allowFail: true, timeout: FETCH_TIMEOUT_MS });
  if (fetched !== null && marker) {
    try { writeFileSync(marker, JSON.stringify({ ref, at: Date.now() })); }
    catch { /* an unwritable git dir only costs the next run a fetch */ }
  }
}

function lines(out) {
  return (out || '').split('\n').filter(Boolean);
}

// Files git marks vendored or generated (linguist-vendored / linguist-generated in
// .gitattributes) — third-party or machine-written content, not the project's own
// code. `buildContext` drops these from the default `ctx.files`, so every check that
// reasons about "the project's code" skips them for free: a suppression marker inside
// a recorded fixture, a placement "violation" in a generated artifact, and a dangling
// link in a vendored doc are none of them the project's decision. `git check-attr`
// honors .gitattributes patterns/precedence natively (paths on stdin so a large repo
// can't overflow the arg list). The unfiltered set stays on `ctx.allFiles` for the one
// check that reasons *about* generated files (generated-merge-driver).
function vendoredSet(root, files) {
  const set = new Set();
  if (!files.length) return set;
  const out = sh(root, 'git', ['check-attr', '--stdin', 'linguist-vendored', 'linguist-generated'],
    { allowFail: true, input: files.join('\n') + '\n' });
  for (const line of (out || '').split('\n')) {
    const m = /^(.*): (?:linguist-vendored|linguist-generated): (.*)$/.exec(line);
    if (m && m[2] === 'set') set.add(m[1]);
  }
  return set;
}

// The complete set of top-level settings .claudinite-checks.json may carry. A key
// outside this set is a typo or a stale name — a settings error as real as invalid
// JSON, caught at load so it can't silently change nothing. `packConfig` is the
// legacy home of per-pack parameters — still honored while the fleet migrates to
// pack-entry `config` (the converge folds it in), no longer documented. The
// `pack-entry-config` baseline migration (engine/migrations/) documents the fold; when
// the fleet is off the old shape, drop the key here (and the overlay below) so
// a straggler gets the unknown-setting error.
// `claudinite` is the vendored-mount stamp — { updated: "<ISO datetime>", ref: "<sha>" },
// written by the nightly update pass, selecting which migration notes still apply
// (vendoring/DESIGN.md owns the model); the checks engine itself only tolerates it.
// `taskScheduler` is the per-repo maintenance anchor the vendored hourly scheduler
// reads (per-project-scheduling DESIGN §2) — { dailyHour, weeklyDay, monthlyDay },
// all UTC. Absence means the documented defaults, so an omitted key is not an
// error; a present one is range-validated at load below. Its declaration is also
// the per-repo cutover marker during the scheduling rollout (MIGRATION Phase 0.6).
// A repo's README pack-badge row has no key here on purpose: the row is seeded at
// adoption and owned by the repo after, so there is nothing for it to configure.
// A member carrying a stale `badges` key therefore gets the unknown-setting error
// below, and the wiring converge (engine/scheduler/converge-wiring.mjs) clears it.
// `dormant` is the project's own declaration that it is out of the RECURRING work —
// see isDormant below for exactly how much that covers.
export const CONFIG_KEYS = ['packs', 'rules', 'accept', 'sharedConstants', 'packConfig', 'maintenance', 'claudinite', 'taskScheduler', 'dormant'];

// Does this project declare itself DORMANT? A project goes dormant when it is
// finished, parked, or simply not being worked on: it should stop paying the
// upkeep of a project that IS being worked on.
//
// What dormancy means, exactly — it is narrow on purpose:
//   - NO RECURRING WORK. The vendored scheduler stops before it evaluates
//     anything (engine/scheduler/queue/tick.mjs), so no work item is instantiated,
//     no agent session is started, and no maintenance PR is opened.
//     Nothing scheduled runs "for nothing" on a repo nobody is working on.
//   - NO FLEET CEREMONY. Whatever looks at this repo from the OUTSIDE reads the
//     same declaration and leaves it alone rather than reporting it as unhealthy —
//     a repo TOLD to stop keeping up must not then be nagged for not keeping up.
//     Which is why this predicate is exported for a raw declaration too (below).
//   - EVERYTHING ELSE STAYS ON. Claudinite is not switched off: the session
//     hooks, the checks engine, the mounted skills and pack prose all work
//     exactly as before the moment someone opens a session on the repo. Dormancy
//     is about unattended upkeep, never about what an interactive session may do.
//
// The predicate reads BOTH shapes deliberately: a raw parsed .claudinite-checks.json
// and the normalized config loadConfig returns. A cross-repo reader fetches another
// repo's declaration over the API with no engine loaded against that tree, and it
// must decide dormancy by the same test that repo's own scheduler used — a second
// notion of dormancy would nag exactly the repos that had already opted out. One
// definition, both sides.
export const isDormant = (config) => config?.dormant === true;

// The keys a `schedule` object may carry, and the canonical weekday vocabulary
// (mirrored from engine/scheduler/calendar.mjs WEEKDAYS — kept as a literal here so
// the checks layer does not import the scheduler engine).
const SCHEDULE_KEYS = ['dailyHour', 'weeklyDay', 'monthlyDay', 'dispatch', 'endpoints'];

// `taskScheduler.dispatch` chose between the slot scheduler and the work-item
// queue while the two coexisted (tasks-dispatch DESIGN §14). The slot scheduler is
// deleted (#974), so `queue` is the only mechanism and the key means nothing.
//
// It stays VALIDATED rather than merely ignored, and `"slots"` is now an error:
// a parameter that has stopped being read must fail loudly, because the one thing
// a member declaring `"slots"` must not get is the queue running silently under a
// declaration that says otherwise. Declaring `"queue"` is still accepted — it says
// what is true — and omitting it is the normal shape.
export const DISPATCH_MODES = ['queue'];
const SCHEDULE_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// The properties a `packs` entry object may carry: the pack's parameters
// (`config`), its adoption-interview answers (`answers` — the owner's verbatim
// responses to the questions the pack declares on its pack.mjs, keyed by
// question id; read by the adoption skill's interview machinery), and the rule overrides / acceptances that
// exist BECAUSE this pack is declared (`rules`, `accept` — they may name any
// rule; the entry is their provenance). `via` is written by
// resolveDeclaredPacks on materialized dependencies (engine/pack_loader/pack-registry.mjs).
export const PACK_ENTRY_KEYS = ['id', 'config', 'answers', 'rules', 'accept', 'via'];

// Load and validate the project's settings. Validity is checked at load — the
// moment Claudinite reads the file — and every problem is collected into `errors`
// (each `{ what, fix }`), the runner's single settings-validity gate. A wrong
// property name, malformed JSON, and a wrong pack name are all equally settings
// errors; unknown *pack* names need the registry, so the runner adds those (it
// holds the known-pack list). On unparsable/misshaped JSON the usable fields fall
// back to empty so the rest of a sweep still runs, with the error reported.
//
// The returned shape is NORMALIZED: `packs` is plain BARE ids (a local pack's
// namespaced `local_packs/<id>` token resolves through packEntryId, so every
// downstream lookup — packEntries, the packConfig view — keys by the pack's
// own id whichever form the file used), `rules` and `accept` are the top-level
// and per-entry settings merged (an entry-sourced acceptance carries
// `pack: <id>` as provenance; conflicting severity overrides are a settings
// error), and `packConfig` is the per-pack parameter view — each entry's
// `config`, overlaid on the legacy top-level key. Checks and env machinery
// read this one shape regardless of which form the file used.
export function loadConfig(root) {
  const path = join(root, '.claudinite-checks.json');
  const empty = { packs: [], packEntries: [], rules: {}, accept: [], sharedConstants: [], packConfig: {}, taskScheduler: null, claudinite: null, maintenance: null, dormant: false, errors: [] };
  if (!existsSync(path)) return empty;

  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    return { ...empty, errors: [{ what: `.claudinite-checks.json is not valid JSON: ${e.message}`, fix: 'fix the JSON syntax' }] };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...empty, errors: [{ what: '.claudinite-checks.json must be a JSON object', fix: 'wrap the settings in an object: { "packs": [ ... ] }' }] };
  }

  const errors = [];
  for (const key of Object.keys(raw)) {
    if (!CONFIG_KEYS.includes(key)) {
      errors.push({ what: `unknown setting "${key}"`, fix: `remove it or fix the name — valid settings: ${CONFIG_KEYS.join(', ')}` });
    }
  }

  // --- packs: each entry a pack id or { id, config?, rules?, accept?, via? } ---
  const packs = [];
  const packEntries = [];
  for (const entry of Array.isArray(raw.packs) ? raw.packs : []) {
    if (typeof entry === 'string') {
      packs.push(packEntryId(entry));
      packEntries.push({ id: packEntryId(entry) });
      continue;
    }
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push({ what: `packs entry ${JSON.stringify(entry)} is neither a pack id nor an entry object`, fix: 'declare a pack as "name" or { "id": "name", ... }' });
      continue;
    }
    if (typeof entry.id !== 'string') {
      errors.push({ what: `packs entry ${JSON.stringify(entry)} has no "id"`, fix: 'give the entry an "id": the pack name' });
      continue;
    }
    for (const key of Object.keys(entry)) {
      if (!PACK_ENTRY_KEYS.includes(key)) {
        errors.push({ what: `unknown property "${key}" on the "${entry.id}" pack entry`, fix: `remove it or fix the name — valid entry properties: ${PACK_ENTRY_KEYS.join(', ')}` });
      }
    }
    const badShape = (prop, expected) =>
      errors.push({ what: `"${prop}" on the "${entry.id}" pack entry must be ${expected}`, fix: `fix or remove the entry's "${prop}"` });
    const normalized = { id: packEntryId(entry) };
    if (entry.config !== undefined) {
      if (entry.config !== null && typeof entry.config === 'object' && !Array.isArray(entry.config)) normalized.config = entry.config;
      else badShape('config', 'an object of the pack\'s parameters');
    }
    if (entry.answers !== undefined) {
      if (entry.answers !== null && typeof entry.answers === 'object' && !Array.isArray(entry.answers)
        && Object.values(entry.answers).every((v) => typeof v === 'string')) normalized.answers = entry.answers;
      else badShape('answers', 'an object mapping the pack\'s question ids to string answers');
    }
    if (entry.rules !== undefined) {
      if (entry.rules !== null && typeof entry.rules === 'object' && !Array.isArray(entry.rules)) normalized.rules = entry.rules;
      else badShape('rules', 'an object of per-rule severity overrides');
    }
    if (entry.accept !== undefined) {
      if (Array.isArray(entry.accept)) normalized.accept = entry.accept;
      else badShape('accept', 'an array of acceptance entries');
    }
    if (entry.via !== undefined) {
      // Written by the declaration resolver on materialized dependencies
      // (engine/pack_loader/pack-registry.mjs) — normalized through so readers (the adoption
      // interview) can tell a chosen pack from a pulled-in one.
      if (Array.isArray(entry.via) && entry.via.every((v) => typeof v === 'string')) normalized.via = entry.via;
      else badShape('via', 'an array of pack ids (the declaration resolver writes it)');
    }
    packs.push(normalized.id);
    packEntries.push(normalized);
  }

  // --- rules: top-level and per-entry merged; a conflict is a settings error,
  // never a silent last-writer-wins — two packs (or a pack and the top level)
  // disagreeing about a rule's severity is a decision the project must make.
  const rules = {};
  const ruleSource = {};
  const mergeRules = (overrides, source) => {
    for (const [ruleId, severity] of Object.entries(overrides)) {
      if (ruleId in rules && rules[ruleId] !== severity) {
        errors.push({
          what: `rule "${ruleId}" is set to "${rules[ruleId]}" by ${ruleSource[ruleId]} and "${severity}" by ${source}`,
          fix: 'make the overrides agree, or keep the rule on one of them',
        });
        continue;
      }
      rules[ruleId] = severity;
      ruleSource[ruleId] = source;
    }
  };
  if (raw.rules && typeof raw.rules === 'object') mergeRules(raw.rules, 'the top-level "rules"');
  for (const entry of packEntries) {
    if (entry.rules) mergeRules(entry.rules, `the "${entry.id}" pack entry`);
  }

  // --- accept: top-level entries, then each pack entry's stamped with its
  // provenance (`pack: <id>` — which declaration motivated the exemption).
  const accept = Array.isArray(raw.accept) ? [...raw.accept] : [];
  for (const entry of packEntries) {
    for (const a of entry.accept ?? []) accept.push({ ...a, pack: entry.id });
  }

  // --- packConfig view: per-pack parameters — e.g. the dirs a repo's
  // package.json lives in for the node pack's env install. Entry `config` is
  // the home; the legacy top-level key stays readable underneath it.
  const packConfig = raw.packConfig && typeof raw.packConfig === 'object' && !Array.isArray(raw.packConfig) ? { ...raw.packConfig } : {};
  for (const entry of packEntries) {
    if (entry.config !== undefined) packConfig[entry.id] = entry.config;
  }

  // --- taskScheduler: the per-repo maintenance anchor (UTC). Range-validated at
  // load so a bad anchor is a settings error like any other; absence is legal
  // (the scheduler fills the documented defaults). The value passes through
  // unchanged for the scheduler to normalize.
  let taskScheduler = null;
  if (raw.taskScheduler !== undefined) {
    if (raw.taskScheduler === null || typeof raw.taskScheduler !== 'object' || Array.isArray(raw.taskScheduler)) {
      errors.push({ what: '"taskScheduler" must be an object', fix: 'e.g. { "dailyHour": 4, "weeklyDay": "Sun", "monthlyDay": 1 }' });
    } else {
      for (const key of Object.keys(raw.taskScheduler)) {
        if (!SCHEDULE_KEYS.includes(key)) {
          errors.push({ what: `unknown "taskScheduler" setting "${key}"`, fix: `remove it or fix the name — valid taskScheduler settings: ${SCHEDULE_KEYS.join(', ')}` });
        }
      }
      const { dailyHour, weeklyDay, monthlyDay } = raw.taskScheduler;
      if (dailyHour !== undefined && !(Number.isInteger(dailyHour) && dailyHour >= 0 && dailyHour <= 23)) {
        errors.push({ what: `"taskScheduler.dailyHour" must be an integer 0–23 (UTC), got ${JSON.stringify(dailyHour)}`, fix: 'set an hour of the day, 0 through 23' });
      }
      if (weeklyDay !== undefined && !SCHEDULE_WEEKDAYS.includes(weeklyDay)) {
        errors.push({ what: `"taskScheduler.weeklyDay" must be one of ${SCHEDULE_WEEKDAYS.join(', ')}, got ${JSON.stringify(weeklyDay)}`, fix: 'name a weekday, e.g. "Sun"' });
      }
      if (monthlyDay !== undefined && !(Number.isInteger(monthlyDay) && monthlyDay >= 1 && monthlyDay <= 31)) {
        errors.push({ what: `"taskScheduler.monthlyDay" must be an integer 1–31, got ${JSON.stringify(monthlyDay)}`, fix: 'set a day of the month, 1 through 31 (clamped to the month length)' });
      }
      const { dispatch, endpoints } = raw.taskScheduler;
      if (dispatch !== undefined && !DISPATCH_MODES.includes(dispatch)) {
        errors.push({
          what: `"taskScheduler.dispatch" must be one of ${DISPATCH_MODES.join(', ')}, got ${JSON.stringify(dispatch)}`,
          fix: 'omit the key — the work-item queue is the only dispatch mechanism; "slots" named the slot scheduler, which is deleted',
        });
      }
      // The endpoint map (tasks-dispatch DESIGN §12): a name → { url, tokenSecret }.
      // `tokenSecret` is the NAME of a repo Actions secret and never a value —
      // that indirection is the whole reason a task may declare an endpoint at all,
      // since a task declaration is vendored verbatim into every consuming repo.
      if (endpoints !== undefined) {
        if (endpoints === null || typeof endpoints !== 'object' || Array.isArray(endpoints)) {
          errors.push({ what: '"taskScheduler.endpoints" must be an object of endpoint name → { url, tokenSecret }', fix: 'e.g. { "default": { "url": "https://…", "tokenSecret": "CCR_SESSION_TOKEN" } }' });
        } else {
          for (const [name, entry] of Object.entries(endpoints)) {
            if (entry === null || typeof entry !== 'object' || Array.isArray(entry)
                || typeof entry.url !== 'string' || typeof entry.tokenSecret !== 'string') {
              errors.push({ what: `"taskScheduler.endpoints.${name}" must be { url, tokenSecret } (both strings)`, fix: 'give the endpoint an invocation URL and the NAME of the repo Actions secret holding its token — never the token itself' });
            }
          }
        }
      }
      taskScheduler = raw.taskScheduler;
    }
  }

  // --- dormant: a plain boolean, validated as one. A string "true", a `{ since }`
  // object or a reason left in its place would all read as dormant to a truthiness
  // test and as active to this one, and the difference is a whole repo's scheduled
  // work — so the wrong TYPE is a settings error, not a value to coerce.
  if (raw.dormant !== undefined && typeof raw.dormant !== 'boolean') {
    errors.push({
      what: `"dormant" must be true or false, got ${JSON.stringify(raw.dormant)}`,
      fix: 'set "dormant": true to stop this project\'s recurring work, or remove the key',
    });
  }

  return {
    packs,
    packEntries,
    rules,
    accept,
    sharedConstants: Array.isArray(raw.sharedConstants) ? raw.sharedConstants : [],
    packConfig,
    taskScheduler,
    // Passed through as declared, not normalized: `claudinite` is the
    // vendored-mount provenance stamp the `stamp` signal reads, and `maintenance`
    // is the delivery preference. Both are in CONFIG_KEYS, so declaring them is
    // legal and raises no error — and omitting them from THIS shape is what made
    // the stamp invisible to the scheduler and silently killed baselining across
    // the whole fleet: every repo self-skipped as "no vendored mount (no stamp)"
    // while its scheduler runs went green. A key that validates but does not
    // survive the load is the worst kind — legal to write, impossible to read,
    // silent in both directions. The CONFIG_KEYS-survive-loadConfig test pins the
    // whole set so no future key can go the same way.
    claudinite: raw.claudinite ?? null,
    maintenance: raw.maintenance ?? null,
    // Normalized to a boolean rather than passed through: everything downstream
    // asks "is this project dormant", and a tri-state (true / false / absent) would
    // invite each caller to answer the absent case for itself. Absent is active.
    dormant: isDormant(raw),
    errors,
  };
}

export function buildContext({ root, mode = 'changed', baseOverride = null, transcriptPath = null }) {
  root = resolve(root);
  const baseRef = baseOverride || resolveBaseRef(root);
  refreshBaseRef(root, baseRef);
  const mergeBase = baseRef ? (gitTry(root, 'merge-base', 'HEAD', baseRef) || '').trim() || null : null;
  // Diffing against HEAD keeps uncommitted work in scope even when no base branch resolves.
  const diffBase = mergeBase || 'HEAD';
  // Is this commit already on the base branch? `--is-ancestor` exits non-zero for "no",
  // which gitTry surfaces as null. No base ref to compare against ⇒ nothing is known to
  // be on it, so nothing is filtered out.
  const onBaseBranch = (sha) =>
    !!baseRef && gitTry(root, 'merge-base', '--is-ancestor', sha, baseRef) !== null;

  const tracked = lines(gitTry(root, 'ls-files'));
  const untracked = lines(gitTry(root, 'ls-files', '--others', '--exclude-standard'));

  const vsBase = lines(gitTry(root, 'diff', '--name-only', '--diff-filter=d', diffBase));
  let scanned;
  if (mode === 'all') {
    scanned = [...tracked, ...untracked];
  } else {
    scanned = [...new Set([...vsBase, ...untracked])];
  }
  // The vendored corpus under the shared mount is canon-owned, never the
  // project's own code — structurally out of scope for every check, on any git
  // host and any checkout (deliberately not attribute-driven). The consumer's
  // own .claudinite/local_packs/ sits BESIDE the shared mount and stays fully
  // in scope.
  // git emits '/'-separated paths on every platform; SHARED_SUBDIR is joined
  // with the platform separator, so normalize before prefix-matching.
  const sharedPrefix = `${SHARED_SUBDIR.split(sep).join('/')}/`;
  scanned = scanned.filter((f) => !f.startsWith(sharedPrefix));
  // Every in-scope regular file, vendored/generated included.
  const allFiles = scanned.filter((f) => existsSync(join(root, f)) && statSync(join(root, f)).isFile());
  // The default sweep excludes vendored/generated files, so `ctx.files` is the
  // project's OWN authored code and every check skips them for free (see vendoredSet).
  const vendored = vendoredSet(root, allFiles);
  const files = allFiles.filter((f) => !vendored.has(f));
  // The in-scope files the current change touched (vs the scoping base),
  // untracked included — the file set behind lines.mjs addedLines, for
  // check-the-work rules that judge the work rather than re-audit the world.
  const changedSet = new Set([...vsBase, ...untracked]);
  const changedFiles = files.filter((f) => changedSet.has(f));

  const deleted = mergeBase ? lines(gitTry(root, 'diff', '--name-only', '--diff-filter=D', mergeBase)) : [];

  let commits = [];
  if (mergeBase) {
    const out = gitTry(root, 'log', '--format=%s%n%b%x00', `${mergeBase}..HEAD`);
    commits = (out || '').split('\0').map((m) => m.trim()).filter(Boolean);
  }

  const branch = (gitTry(root, 'rev-parse', '--abbrev-ref', 'HEAD') || '').trim();

  // Conversation surface: the Stop hook forwards the session's transcript_path;
  // every other surface (CI, a manual run) has none, and conversation rules must
  // return [] when this is null. Parsed lazily and cached — most sweeps never ask.
  let conversationCache;

  // Checks are read-only over an immutable snapshot of the tree, so file and
  // base-blob reads are cached for the sweep: many rules re-read the same files,
  // and each readBase is otherwise a git subprocess.
  const readCache = new Map();
  const readBaseCache = new Map();

  return {
    root,
    mode,
    baseRef,
    mergeBase,
    files,
    allFiles,
    changedFiles,
    tracked,
    deleted,
    commits,
    branch,
    config: loadConfig(root),

    exists: (path) => existsSync(join(root, path)),
    read(path) {
      if (!readCache.has(path)) {
        let text;
        try { text = readFileSync(join(root, path), 'utf8'); } catch { text = null; }
        readCache.set(path, text);
      }
      return readCache.get(path);
    },

    // File content at the scoping base (the merge-base with the base branch), or
    // null if the file didn't exist there or no base resolves. Lets a delta
    // check compare structured state — e.g. a manifest's permission set — against
    // the baseline precisely, immune to text-diff line noise (JSON trailing
    // commas make appending an array element re-touch the previous line).
    readBase(path) {
      if (!mergeBase) return null;
      if (!readBaseCache.has(path)) readBaseCache.set(path, gitTry(root, 'show', `${mergeBase}:${path}`));
      return readBaseCache.get(path);
    },

    // Added lines of one file relative to the scoping base (untracked file = every line).
    addedLines(file) {
      if (!tracked.includes(file)) {
        const text = this.read(file);
        return text === null ? [] : text.split('\n').map((t, i) => ({ line: i + 1, text: t }));
      }
      const out = gitTry(root, 'diff', '-U0', diffBase, '--', file);
      const added = [];
      let lineNo = 0;
      for (const l of (out || '').split('\n')) {
        const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
        if (hunk) { lineNo = Number(hunk[1]); continue; }
        if (l.startsWith('+') && !l.startsWith('+++')) { added.push({ line: lineNo, text: l.slice(1) }); lineNo += 1; }
        else if (!l.startsWith('-')) lineNo += l ? 1 : 0;
      }
      return added;
    },

    // Parsed transcript entries of the session driving this run, or null when no
    // transcript is available (see conversationCache above).
    conversation() {
      if (conversationCache !== undefined) return conversationCache;
      if (!transcriptPath || !existsSync(transcriptPath)) return (conversationCache = null);
      try { conversationCache = parseEntries(readFileSync(transcriptPath, 'utf8')); }
      catch { conversationCache = null; }
      return conversationCache;
    },

    // The branch's own commits since the merge-base, oldest first, each with its
    // changed files and committer date — for rules about the ORDER work landed in
    // (ctx.commits keeps only messages). Merges excluded: their file list is
    // empty under --name-only and their content arrives via their parents.
    commitsWithFiles() {
      if (!mergeBase) return [];
      const out = gitTry(root, 'log', '--reverse', '--no-merges', '--name-only',
        '--format=%x00%H%x1f%cI%x1f%s', `${mergeBase}..HEAD`);
      const commits = [];
      for (const block of (out || '').split('\0')) {
        if (!block.trim()) continue;
        const [head, ...rest] = block.trim().split('\n');
        const [sha, date, subject] = head.split('\x1f');
        commits.push({ sha, date, subject, files: rest.map((f) => f.trim()).filter(Boolean) });
      }
      return commits;
    },

    // Merge commits the current change introduces — those on HEAD's first-parent
    // chain since the merge-base with the base branch (the squash-only effect
    // check, scoped to the work). Empty when no base resolves or the branch is
    // even with it; pre-existing merges already on the base are out of range.
    //
    // The range alone trusts the merge-base to be right, and it isn't always: a
    // shallow clone's grafted boundary or a criss-cross history can hand back a
    // merge-base that sweeps the base branch's own merges into the range. So each
    // candidate is confirmed against the base ref itself — a merge already on the
    // base branch was never introduced here, whatever the range says. Offline and
    // exact, and it holds when refreshBaseRef couldn't run.
    introducedMergeCommits() {
      if (!mergeBase) return [];
      const out = gitTry(root, 'log', '--merges', '--first-parent', '--format=%h %s', `${mergeBase}..HEAD`);
      return lines(out).map((l) => {
        const i = l.indexOf(' ');
        return { sha: l.slice(0, i), subject: l.slice(i + 1) };
      }).filter(({ sha }) => !onBaseBranch(sha));
    },

    // Fixed-string search across tracked files; git grep exits 1 on no match.
    // The vendored shared mount is structurally out of the sweep (canon-owned,
    // never the project's own code — vendoring/DESIGN.md item 6), so it is
    // excluded here exactly as it is from the scanned file set above: a hit
    // inside it must never become a finding.
    grepTracked(needle) {
      const out = gitTry(root, 'grep', '-n', '-F', needle, '--', '.', `:(exclude)${sharedPrefix}`);
      return lines(out).map((l) => {
        const m = /^([^:]+):(\d+):(.*)$/.exec(l);
        return m ? { file: m[1], line: Number(m[2]), text: m[3] } : null;
      }).filter(Boolean);
    },
  };
}

export const pathDepth = (p) => (p === '.' || p === '' ? [] : p.split(sep));
