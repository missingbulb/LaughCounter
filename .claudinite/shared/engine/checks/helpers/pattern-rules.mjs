import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { finding } from './findings.mjs';
import { parseYaml } from './minimal-yaml.mjs';

// The declarative pattern-check engine: a rule whose whole logic is "these
// patterns over these files" is DECLARED as data — and data is JSON, not code.
// A pack's declarations live in `packs/<pack>/declared-checks.json` (a skill's
// in `<pack>/skills/<name>/declared-checks.json`), an array of specs the pack
// registry discovers structurally and compiles here into ordinary
// `{ id, severity, why, run(ctx) }` rule objects the runner treats like any
// other. Nothing wires them: dropping a declaration into the file adds it.
//
// The format admits no comments — the pattern plus its failureMessage/what/fix
// text IS the check — and no prose pointers: a declaration states its own case
// or it isn't finished. So a spec carries exactly:
//   id              the rule id settings and findings name it by
//   severity        'blocking' | 'advisory'
//   failureMessage  why this matters, printed on every finding the rule makes
//   …the assertions below, each with the `what` and `fix` it fails with
//
// REGEXES ARE STRINGS in `/body/flags` form — "/^\\s*schedule:/m" — compiled at
// load. Keys that accept a path instead (scanFiles, excludeFiles, pathExists)
// read any other string as an exact repo path; at every other pattern key a
// string that is not in `/…/` form is an authoring error, reported as one.
// The engine owns only the walking (the mechanism/policy line line-scanning.mjs
// draws): every pattern, file filter, and failure text stays in the declaration.
// Spec keys are deliberately wordy — a declaration must read as the whole check
// without this header.
//
// Built for MANY such rules at once: however many pattern rules a run holds,
// the engine makes ONE pass over the scanned tree — each file is read once and
// its lines split once, with every subscribing rule's assertions evaluated in
// that single visit — and the per-context results are cached, so the first
// pattern rule the runner reaches pays for the whole family and the rest are
// lookups. Regexes must be non-global (`.test` on a /g regex is stateful).
//
// The spec vocabulary — everything beyond the rule metadata is optional:
//   scanFiles          which files the content assertions read: a RegExp over
//                      repo paths, or one exact path (read directly)
//   scanTracked        true = scan every git-tracked file (mode-independent);
//                      default is ctx.files (the run's scanned set —
//                      tracked+untracked minus vendored, and only the changed
//                      files under --changed)
//   excludeFiles       RegExp (or exact path) removing files from scope
//   relevantWhen       repo-level relevance, all parts must hold:
//                        pathExists / pathAbsent          a path present/absent
//                        trackedFileMatches               some tracked path matches
//                        noTrackedFileMatches             no tracked path matches
//                        exactlyOneTrackedFileMatches     exactly one tracked path matches
//                        someTrackedFileContains          { pathMatching, text } — some
//                                                         tracked path matching the first
//                                                         has text matching the second
//                        scanningWholeRepo                true = only under a whole-repo
//                                                         sweep (mode 'all'), never a
//                                                         --changed run
//                        repoContains                     some in-scope file's text
//                                                         matches — evaluated only
//                                                         if findings exist
//   whenMissing        { what, fix } — fires when an exact-path scanFiles is absent
//   maxLines           { limit, what, fix } — fires past `limit` lines, anchored there
//   skipLinesMatching  RegExp — lines it matches are invisible to matchLines
//   matchLines         [{ match, unlessLineMatches, whenFileMatches,
//                         unlessFileMatches, what, fix }]
//                      flag each line `match` hits (unless `unlessLineMatches`
//                      hits it too), in files where every `whenFileMatches`
//                      matches and `unlessFileMatches` does not; per line, the
//                      first matching assertion wins
//   checkEachFile      [{ relevantWhen, whenFileMatches, require, forbid, what, fix }]
//                      one finding per file: where every `whenFileMatches`
//                      matches, `require` must match / `forbid` must not
//                      (`whenFileMatches` takes one RegExp or a list)
//   repoWide           [{ unlessSomeFileMatches, flagFilesMatching,
//                         neverFlagFiles, what, fix }]
//                      unless some in-scope file matches `unlessSomeFileMatches`,
//                      flag every file (minus `neverFlagFiles`) satisfying a
//                      `flagFilesMatching` group — a list of all-must-match
//                      RegExp lists — anchored at the first group's first
//                      pattern's first matching line
//   requirePaths       [{ path, what, fix }] — each path must exist on disk
//   listedInFile       [{ eachTrackedPathMatching, listFile, asText, what, fix }]
//                      every tracked path the RegExp matches must appear in
//                      `listFile` as the `asText` template (capture groups
//                      interpolate); findings anchor on the list file, sorted,
//                      and an absent list file asserts nothing
//   coveredByGlobLine  [{ eachPathMatching, includeVendored, globFile,
//                         globLineMatching, what, fix }]
//                      every scanned path the RegExp matches (includeVendored:
//                      true widens to ctx.allFiles) must be covered — full path
//                      or basename — by the first-token glob of some
//                      non-comment `globFile` line matching `globLineMatching`;
//                      findings anchor on each uncovered path
//
// The structured-data assertions read PARSED documents — `.json` via JSON.parse,
// `.yaml`/`.yml` via the minimal YAML parser — each file parsed at most once per
// scan, shared by every rule; an absent or unparsable document asserts nothing.
// A field path is dot-separated (`devDependencies.esbuild`), and a field counts
// as present when its value is not undefined:
//   checkParsedFile    [{ file, whenFieldPresent, requireField, forbidField,
//                         what, fix }]
//                      in the parsed document: where `whenFieldPresent` is
//                      present, `requireField` must be present / `forbidField`
//                      must not
//   equalParsedValues  [{ first: { file | filesMatching + whereFileContains,
//                                  field },
//                         second: { file, field },
//                         whenSecondMissing, whenUnequal }]
//                      the two parsed fields must be equal; `filesMatching` +
//                      `whereFileContains` select the first tracked file whose
//                      path and text match; an absent second file fires
//                      `whenSecondMissing` at its path, a mismatch fires
//                      `whenUnequal` at the first file with {first}/{second}
//   forEachParsedEntry [{ inFilesMatching, entriesAtField, whereFieldEquals:
//                         { field, equals }, forbidValueInArray: { atField,
//                         value, ignoreCase }, what, fix }]
//                      in each tracked file matching, for each named entry of
//                      the object at `entriesAtField` whose `whereFieldEquals`
//                      holds: the array at `atField` must not contain `value`;
//                      {entry} interpolates the entry's name
//   checkKeyValueFile  [{ file, keys, whenMissing, whenLineNotKeyValue,
//                         whenKeyUnknown, whenKeyMissing }]
//                      the dotenv-style file must exist, hold only KEY=value
//                      lines and # comments, use only the declared keys, and
//                      declare every one; {key}/{keys}/{line} interpolate
//
// The markdown-section assertions read each scanned page's `## ` sections —
// headings matched case-insensitively with suffix words allowed, fenced code
// blocks invisible, a section running to the next `## ` heading or EOF. A
// top-level bullet is a column-0 `-`/`*`/`+` line; a bullet BLOCK is the bullet
// plus its indented continuation lines; a DATED bullet leads with its
// YYYY-MM-DD run date, bold or plain, validated as a real calendar date. Every
// assertion except requirePresent asserts nothing when the section is absent
// (presence is its own declared finding, never double-reported):
//   checkSections      [{ section | sections: [names], … }] with, each optional:
//                        requirePresent                   the `## {section}` heading must exist
//                        requireFirstOnPage               no other `## ` heading may precede it
//                                                         ({first} = the heading that does)
//                        forbidProseLines                 non-bullet, non-continuation lines
//                                                         are findings ({line} = the text)
//                        eachBulletBlockMatches           { pattern } — every bullet block must match
//                        eachBulletLeadsWithDate          { whenUndated, whenNotRealDate } —
//                                                         every bullet starts with a real date
//                                                         ({date} = the one that isn't)
//                        minBullets / maxBullets          { count } — bullet-count floor/ceiling
//                                                         ({bullets} = the actual count)
//                        maxBulletBlockLength             { characters } — block-length ceiling
//                                                         ({characters} = the actual length)
//                        newestDatedBulletWithinDays      { days } — the newest dated bullet
//                                                         (dates > 2 days in the future
//                                                         discarded; clock = ctx.now, wall
//                                                         clock otherwise) must be at most
//                                                         `days` old ({age}, {date}, {days})
//                      {bullet} everywhere = the bullet line's first 80 characters
//
// `what`/`fix` are templates: `{path}`, a named capture group's `{name}`, and
// `{match}` (a matchLines hit's text), `{lines}`/`{limit}` (maxLines) interpolate.

const REGISTRY = [];
const scans = new WeakMap();

const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (whole, key) => (key in vars ? String(vars[key]) : whole));
const excluded = (path, exclude) =>
  exclude != null && (exclude instanceof RegExp ? exclude.test(path) : path === exclude);

function relevant(ctx, when) {
  if (!when) return true;
  if (when.pathExists && !ctx.exists(when.pathExists)) return false;
  if (when.pathAbsent && ctx.exists(when.pathAbsent)) return false;
  if (when.trackedFileMatches && !ctx.tracked.some((f) => when.trackedFileMatches.test(f))) return false;
  if (when.noTrackedFileMatches && ctx.tracked.some((f) => when.noTrackedFileMatches.test(f))) return false;
  if (when.exactlyOneTrackedFileMatches &&
      ctx.tracked.filter((f) => when.exactlyOneTrackedFileMatches.test(f)).length !== 1) return false;
  if (when.someTrackedFileContains &&
      !ctx.tracked.some((f) => when.someTrackedFileContains.pathMatching.test(f) &&
        when.someTrackedFileContains.text.test(ctx.read(f) ?? ''))) return false;
  if (when.scanningWholeRepo && ctx.mode !== 'all') return false;
  return true; // repoContains resolves after the pass, and only when findings exist
}

// --- markdown-section machinery (checkSections) ------------------------------

const MD_BULLET = /^[-*+]\s/;
const MD_DATED = /^[-*+]\s+(?:\*\*)?(\d{4})-(\d{2})-(\d{2})(?:\*\*)?\b/;
const MD_CONTINUATION = /^\s+\S/;
const DAY_MS = 86_400_000;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Date.UTC rolls out-of-range parts over (2026-02-30 → March 2) instead of
// failing, so calendar validity needs the explicit round-trip.
function realDateUTC(y, mo, d) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
    ? dt.getTime() : null;
}

// One parse of a page's section structure, shared by every subscribing rule:
// fenced lines blanked (count preserved, so line numbers never shift), the
// first `## ` heading, and each named section's body ({ line, text } entries,
// 1-indexed) memoized per name.
function markdownIndex(text) {
  let inFence = false;
  const stripped = text.split('\n').map((l) => {
    if (/^\s*(```|~~~)/.test(l)) { inFence = !inFence; return ''; }
    return inFence ? '' : l;
  });
  const firstLine = stripped.find((l) => /^##\s/.test(l));
  const sections = new Map();
  return {
    firstHeading: firstLine === undefined ? null : firstLine.replace(/^##\s+/, '').trim(),
    section(name) {
      const key = name.toLowerCase();
      if (!sections.has(key)) {
        const re = new RegExp(`^##\\s+${escapeRe(name)}\\b`, 'i');
        const start = stripped.findIndex((l) => re.test(l));
        if (start === -1) sections.set(key, null);
        else {
          let end = stripped.length;
          for (let i = start + 1; i < stripped.length; i++) {
            if (/^##\s/.test(stripped[i])) { end = i; break; }
          }
          sections.set(key, stripped.slice(start + 1, end).map((t, i) => ({ line: start + 2 + i, text: t })));
        }
      }
      return sections.get(key);
    },
  };
}

function assertSections(ctx, j, path, md) {
  const excerpt = (s) => s.trim().slice(0, 80);
  const push = (a, at, vars) => j.out.push(finding(j.rule, {
    file: path, ...(at === null ? {} : { line: at }), what: fill(a.what, vars), fix: fill(a.fix, vars),
  }));

  for (const entry of j.spec.checkSections) {
    for (const name of entry.sections ?? [entry.section]) {
      const body = md().section(name);
      const vars = { section: name };
      if (body === null) {
        if (entry.requirePresent) push(entry.requirePresent, null, vars);
        continue;
      }

      if (entry.requireFirstOnPage) {
        const first = md().firstHeading;
        if (first !== null && !new RegExp(`^${escapeRe(name)}\\b`, 'i').test(first)) {
          push(entry.requireFirstOnPage, null, { ...vars, first });
        }
      }

      let bullets = 0;
      const dated = [];
      const now = ctx.now ?? Date.now();
      for (let i = 0; i < body.length; i++) {
        const { line, text: t } = body[i];
        if (!MD_BULLET.test(t)) {
          if (entry.forbidProseLines && t.trim() !== '' && !MD_CONTINUATION.test(t)) {
            push(entry.forbidProseLines, line, { ...vars, line: excerpt(t) });
          }
          continue;
        }
        bullets += 1;
        const m = MD_DATED.exec(t);
        if (entry.eachBulletLeadsWithDate) {
          if (!m) push(entry.eachBulletLeadsWithDate.whenUndated, line, { ...vars, bullet: excerpt(t) });
          else if (realDateUTC(+m[1], +m[2], +m[3]) === null) {
            push(entry.eachBulletLeadsWithDate.whenNotRealDate, line, { ...vars, date: `${m[1]}-${m[2]}-${m[3]}` });
          }
        }
        if (entry.newestDatedBulletWithinDays && m) {
          const ts = realDateUTC(+m[1], +m[2], +m[3]);
          if (ts !== null && ts <= now + 2 * DAY_MS) dated.push(ts);
        }
        if (entry.eachBulletBlockMatches || entry.maxBulletBlockLength) {
          let block = t;
          for (let k = i + 1; k < body.length && MD_CONTINUATION.test(body[k].text); k++) {
            block += ` ${body[k].text.trim()}`;
          }
          if (entry.eachBulletBlockMatches && !entry.eachBulletBlockMatches.pattern.test(block)) {
            push(entry.eachBulletBlockMatches, line, { ...vars, bullet: excerpt(t) });
          }
          if (entry.maxBulletBlockLength && block.trim().length > entry.maxBulletBlockLength.characters) {
            push(entry.maxBulletBlockLength, line, { ...vars, bullet: excerpt(t), characters: block.trim().length });
          }
        }
      }

      if (entry.minBullets && bullets < entry.minBullets.count) {
        push(entry.minBullets, null, { ...vars, bullets });
      } else if (entry.maxBullets && bullets > entry.maxBullets.count) {
        push(entry.maxBullets, null, { ...vars, bullets });
      }

      if (entry.newestDatedBulletWithinDays && dated.length) {
        const a = entry.newestDatedBulletWithinDays;
        const newest = Math.max(...dated);
        const age = Math.floor(((ctx.now ?? Date.now()) - newest) / DAY_MS);
        if (age > a.days) {
          push(a, null, { ...vars, age, days: a.days, date: new Date(newest).toISOString().slice(0, 10) });
        }
      }
    }
  }
}

const fieldAt = (doc, path) =>
  path.split('.').reduce((v, key) => (v && typeof v === 'object' ? v[key] : undefined), doc);

function globToRe(glob) {
  return new RegExp(
    `^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`
  );
}

// The tree/index assertions — they match paths and read at most one index file,
// so they run directly per rule rather than riding the content pass.
function assertTreeShape(ctx, j) {
  const s = j.spec;
  for (const a of s.requirePaths ?? []) {
    if (ctx.exists(a.path)) continue;
    const vars = { path: a.path };
    j.out.push(finding(j.rule, { file: a.path, what: fill(a.what, vars), fix: fill(a.fix, vars) }));
  }

  for (const a of s.listedInFile ?? []) {
    const list = ctx.read(a.listFile);
    if (list === null) continue;
    const missing = new Map();
    for (const path of ctx.tracked) {
      const m = a.eachTrackedPathMatching.exec(path);
      if (!m) continue;
      const vars = { path, ...(m.groups ?? {}) };
      const token = fill(a.asText, vars);
      if (!missing.has(token) && !list.includes(token)) missing.set(token, vars);
    }
    for (const [, vars] of [...missing].sort(([t1], [t2]) => t1.localeCompare(t2))) {
      j.out.push(finding(j.rule, { file: a.listFile, what: fill(a.what, vars), fix: fill(a.fix, vars) }));
    }
  }

  for (const a of s.coveredByGlobLine ?? []) {
    const globs = (ctx.read(a.globFile) ?? '').split('\n')
      .filter((line) => a.globLineMatching.test(line) && !line.trim().startsWith('#'))
      .map((line) => globToRe(line.trim().split(/\s+/)[0]));
    for (const path of a.includeVendored ? ctx.allFiles : ctx.files) {
      const m = a.eachPathMatching.exec(path);
      if (!m) continue;
      const base = path.slice(path.lastIndexOf('/') + 1);
      if (globs.some((re) => re.test(path) || re.test(base))) continue;
      const vars = { path, ...(m.groups ?? {}) };
      j.out.push(finding(j.rule, { file: path, what: fill(a.what, vars), fix: fill(a.fix, vars) }));
    }
  }
}

// The structured-data assertions — they read a few named or tracked documents
// through the scan's shared parse cache, so like the tree assertions they run
// directly per rule rather than riding the content pass.
function assertParsedShape(ctx, j, parsed) {
  const s = j.spec;

  for (const a of s.checkParsedFile ?? []) {
    const doc = parsed(a.file);
    if (doc == null) continue;
    if (a.whenFieldPresent && fieldAt(doc, a.whenFieldPresent) === undefined) continue;
    if (a.forbidField ? fieldAt(doc, a.forbidField) !== undefined
      : fieldAt(doc, a.requireField) === undefined) {
      j.out.push(finding(j.rule, { file: a.file, what: a.what, fix: a.fix }));
    }
  }

  for (const a of s.equalParsedValues ?? []) {
    const firstPath = a.first.file ?? ctx.tracked.find((f) =>
      a.first.filesMatching.test(f) && a.first.whereFileContains.test(ctx.read(f) ?? ''));
    if (!firstPath) continue;
    const firstDoc = parsed(firstPath);
    if (firstDoc == null) continue;
    if (ctx.read(a.second.file) === null) {
      j.out.push(finding(j.rule, { file: a.second.file, what: a.whenSecondMissing.what, fix: a.whenSecondMissing.fix }));
      continue;
    }
    const secondDoc = parsed(a.second.file);
    if (secondDoc == null) continue;
    const vars = { first: fieldAt(firstDoc, a.first.field), second: fieldAt(secondDoc, a.second.field) };
    if (vars.first !== vars.second) {
      j.out.push(finding(j.rule, {
        file: firstPath, what: fill(a.whenUnequal.what, vars), fix: fill(a.whenUnequal.fix, vars),
      }));
    }
  }

  for (const a of s.forEachParsedEntry ?? []) {
    for (const path of ctx.tracked) {
      if (!a.inFilesMatching.test(path)) continue;
      const entries = fieldAt(parsed(path), a.entriesAtField);
      if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue;
      for (const [name, entry] of Object.entries(entries)) {
        if (!entry || typeof entry !== 'object') continue;
        if (a.whereFieldEquals && fieldAt(entry, a.whereFieldEquals.field) !== a.whereFieldEquals.equals) continue;
        const values = fieldAt(entry, a.forbidValueInArray.atField);
        if (!Array.isArray(values)) continue;
        const norm = (v) => (a.forbidValueInArray.ignoreCase ? String(v).toLowerCase() : String(v));
        if (!values.some((v) => norm(v) === norm(a.forbidValueInArray.value))) continue;
        const vars = { entry: name, path };
        j.out.push(finding(j.rule, { file: path, what: fill(a.what, vars), fix: fill(a.fix, vars) }));
      }
    }
  }

  for (const a of s.checkKeyValueFile ?? []) {
    const keysVar = { keys: a.keys.join(', ') };
    const text = ctx.read(a.file);
    if (text === null) {
      j.out.push(finding(j.rule, { file: a.file, what: fill(a.whenMissing.what, keysVar), fix: fill(a.whenMissing.fix, keysVar) }));
      continue;
    }
    const seen = new Set();
    text.split('\n').forEach((raw, i) => {
      const line = raw.trim();
      if (!line || line.startsWith('#')) return;
      const eq = line.indexOf('=');
      if (eq === -1) {
        const vars = { ...keysVar, line };
        j.out.push(finding(j.rule, { file: a.file, line: i + 1, what: fill(a.whenLineNotKeyValue.what, vars), fix: fill(a.whenLineNotKeyValue.fix, vars) }));
        return;
      }
      const key = line.slice(0, eq).trim();
      if (!a.keys.includes(key)) {
        const vars = { ...keysVar, key };
        j.out.push(finding(j.rule, { file: a.file, line: i + 1, what: fill(a.whenKeyUnknown.what, vars), fix: fill(a.whenKeyUnknown.fix, vars) }));
      }
      seen.add(key);
    });
    for (const key of a.keys) {
      if (seen.has(key)) continue;
      const vars = { ...keysVar, key };
      j.out.push(finding(j.rule, { file: a.file, what: fill(a.whenKeyMissing.what, vars), fix: fill(a.whenKeyMissing.fix, vars) }));
    }
  }
}

// One file visited once for every subscribing rule: whole-text assertions and
// repo-wide bookkeeping first, then a single walk of the lines shared by all
// the rules' line assertions.
function visit(ctx, subs, path, text) {
  let split = null;
  const lines = () => (split ??= text.split('\n'));
  let mdIndex = null;
  const md = () => (mdIndex ??= markdownIndex(text));
  const lineJobs = [];

  for (const j of subs) {
    const s = j.spec;
    if (s.checkSections) assertSections(ctx, j, path, md);
    if (s.maxLines && lines().length > s.maxLines.limit) {
      const vars = { lines: lines().length, limit: s.maxLines.limit };
      j.out.push(finding(j.rule, {
        file: path, line: s.maxLines.limit + 1,
        what: fill(s.maxLines.what, vars), fix: fill(s.maxLines.fix, vars),
      }));
    }
    for (const a of s.checkEachFile ?? []) {
      if (a.relevantWhen && !relevant(ctx, a.relevantWhen)) continue;
      if (!arr(a.whenFileMatches).every((re) => re.test(text))) continue;
      if (a.forbid ? a.forbid.test(text) : !a.require.test(text)) {
        j.out.push(finding(j.rule, { file: path, what: a.what, fix: a.fix }));
      }
    }
    for (const st of j.repoStates) {
      if (st.a.unlessSomeFileMatches.test(text)) st.satisfied = true;
      if (excluded(path, st.a.neverFlagFiles)) continue;
      const group = st.a.flagFilesMatching.find((g) => g.every((re) => re.test(text)));
      if (group) {
        const at = lines().findIndex((ln) => group[0].test(ln));
        st.hits.push({ file: path, line: at === -1 ? null : at + 1, what: st.a.what, fix: st.a.fix });
      }
    }
    const eligible = (s.matchLines ?? []).filter((a) =>
      arr(a.whenFileMatches).every((re) => re.test(text)) && !a.unlessFileMatches?.test(text));
    if (eligible.length) lineJobs.push({ j, eligible });
  }

  if (!lineJobs.length) return;
  lines().forEach((ln, i) => {
    for (const { j, eligible } of lineJobs) {
      if (j.spec.skipLinesMatching?.test(ln)) continue;
      for (const a of eligible) {
        const m = ln.match(a.match);
        if (!m || a.unlessLineMatches?.test(ln)) continue;
        const vars = { match: m[0] };
        j.out.push(finding(j.rule, {
          file: path, line: i + 1, what: fill(a.what, vars), fix: fill(a.fix, vars),
        }));
        break;
      }
    }
  });
}

function results(ctx) {
  let res = scans.get(ctx);
  if (res) return res;
  res = new Map();
  scans.set(ctx, res);

  const jobs = [];
  for (const rule of REGISTRY) {
    const out = [];
    res.set(rule, out);
    if (!relevant(ctx, rule.spec.relevantWhen)) continue;
    jobs.push({
      rule, spec: rule.spec, out,
      repoStates: (rule.spec.repoWide ?? []).map((a) => ({ a, satisfied: false, hits: [] })),
    });
  }

  const parsedDocs = new Map();
  const parsed = (path) => {
    if (!parsedDocs.has(path)) {
      const text = ctx.read(path);
      let doc = null;
      if (text !== null) {
        if (/\.ya?ml$/.test(path)) doc = parseYaml(text);
        else { try { doc = JSON.parse(text); } catch { doc = null; } }
      }
      parsedDocs.set(path, doc);
    }
    return parsedDocs.get(path);
  };

  for (const j of jobs) {
    assertTreeShape(ctx, j);
    assertParsedShape(ctx, j, parsed);
    if (typeof j.spec.scanFiles !== 'string') continue;
    const text = ctx.read(j.spec.scanFiles);
    if (text === null) {
      if (j.spec.whenMissing) {
        j.out.push(finding(j.rule, { file: j.spec.scanFiles, what: j.spec.whenMissing.what, fix: j.spec.whenMissing.fix }));
      }
      continue;
    }
    visit(ctx, [j], j.spec.scanFiles, text);
  }

  const swept = jobs.filter((j) => j.spec.scanFiles instanceof RegExp);
  if (swept.length) {
    const scanned = new Set(ctx.files);
    const tracked = new Set(ctx.tracked);
    for (const path of [...ctx.files, ...ctx.tracked.filter((f) => !scanned.has(f))]) {
      const subs = swept.filter((j) =>
        (j.spec.scanTracked ? tracked : scanned).has(path) &&
        j.spec.scanFiles.test(path) && !excluded(path, j.spec.excludeFiles));
      if (!subs.length) continue;
      const text = ctx.read(path);
      if (text !== null) visit(ctx, subs, path, text);
    }
  }

  for (const j of jobs) {
    for (const st of j.repoStates) {
      if (!st.satisfied) for (const h of st.hits) j.out.push(finding(j.rule, h));
    }
    const marker = j.spec.relevantWhen?.repoContains;
    if (marker && j.out.length &&
        !ctx.files.some((f) => !excluded(f, j.spec.excludeFiles) && marker.test(ctx.read(f) ?? ''))) {
      j.out.length = 0;
    }
  }
  return res;
}

// Where a declaration says RegExp: keys reading `/body/flags` strings. The two
// sets differ in what a NON-regex string means — a path at PATH_OR_PATTERN_KEYS
// (scanFiles: "README.md" is read directly), an authoring error anywhere else.
const PATH_OR_PATTERN_KEYS = new Set(['scanFiles', 'excludeFiles']);
const PATTERN_KEYS = new Set([
  'skipLinesMatching', 'match', 'unlessLineMatches', 'whenFileMatches', 'unlessFileMatches',
  'require', 'forbid', 'trackedFileMatches', 'noTrackedFileMatches', 'exactlyOneTrackedFileMatches',
  'pathMatching', 'text', 'repoContains', 'unlessSomeFileMatches', 'flagFilesMatching',
  'neverFlagFiles', 'eachTrackedPathMatching', 'eachPathMatching', 'globLineMatching',
  'filesMatching', 'whereFileContains', 'inFilesMatching', 'pattern',
]);
const RE_FORM = /^\/(.*)\/([dgimsuvy]*)$/s;

// Compile a spec's pattern strings in place of their keys, leaving every other
// value (paths, field names, failure text, numbers) exactly as declared. A real
// RegExp passes through, so a spec built in code — the engine's own tests — is
// the same object either way.
function compileSpec(value, key, where) {
  if (Array.isArray(value)) return value.map((v) => compileSpec(v, key, where));
  if (value === null || value instanceof RegExp) return value;
  if (typeof value === 'string') {
    if (!PATTERN_KEYS.has(key) && !PATH_OR_PATTERN_KEYS.has(key)) return value;
    const form = RE_FORM.exec(value);
    if (!form) {
      if (PATH_OR_PATTERN_KEYS.has(key)) return value;
      throw new Error(`${where}: "${key}" takes a regex in /pattern/flags form, not ${JSON.stringify(value)}`);
    }
    try { return new RegExp(form[1], form[2]); }
    catch (e) { throw new Error(`${where}: "${key}" is not a valid regex — ${e.message}`); }
  }
  if (typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = compileSpec(v, k, where);
  return out;
}

export function patternRule(declaration) {
  const spec = compileSpec(declaration, null, `the declared check "${declaration.id}"`);
  const rule = {
    id: spec.id,
    severity: spec.severity,
    why: spec.failureMessage,
    spec,
    run(ctx) { return results(ctx).get(rule); },
  };
  REGISTRY.push(rule);
  return rule;
}

// A directory's declared checks: `<dir>/declared-checks.json`, an array of specs
// compiled into rules — none when the file is absent. Cached by path, so the
// registry and a test asking the same directory share one set of rule objects
// (two would each re-run the shared scan for the same assertions).
const loaded = new Map();
export function loadDeclaredChecks(dir) {
  const path = join(dir, 'declared-checks.json');
  if (!loaded.has(path)) {
    let specs = [];
    if (existsSync(path)) {
      let raw;
      try { raw = JSON.parse(readFileSync(path, 'utf8')); }
      catch (e) { throw new Error(`${path} is not valid JSON: ${e.message}`); }
      if (!Array.isArray(raw)) throw new Error(`${path} must be an array of check declarations`);
      specs = raw;
    }
    loaded.set(path, specs.map(patternRule));
  }
  return loaded.get(path);
}
