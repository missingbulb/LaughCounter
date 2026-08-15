import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { finding } from './findings.mjs';
import { parseYaml } from './minimal-yaml.mjs';
import { stripComments } from './code-scanning.mjs';
import { normalizeEdges, barrierFindings, staleFindings } from './reference-scanning.mjs';

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
// Every key at every level is validated against the vocabulary at load — an
// unknown key is an authoring error (a typo'd key would otherwise assert
// nothing, silently), reported with the container's valid keys.
//
// The spec vocabulary — everything beyond the rule metadata is optional:
//   fix                rule-level default: any assertion declaring `what` but
//                      no `fix` of its own inherits this one (for rules whose
//                      every assertion shares one remedy)
//   scanFiles          which files the content assertions read: a RegExp over
//                      repo paths, or one exact path (read directly)
//   scanFileClasses    named shared file sets widening the scan scope (unioned
//                      with a RegExp scanFiles): javascriptFiles, pythonFiles,
//                      markdownFiles, workflowFiles, testFiles
//   excludeFileClasses named shared file sets removed from scope (the same
//                      class names — testFiles is the usual one)
//   scanIgnoringComments  true = content assertions (matchLines, checkEachFile,
//                      repoWide) read each file with its JS/TS comments blanked
//                      (string-aware, line count preserved — code-scanning.mjs
//                      stripComments), so a comment merely naming a forbidden
//                      token never fires
//   scanIgnoringMarkdownFences  true = content assertions read each markdown
//                      file with its fenced code blocks blanked (line count
//                      preserved — the view checkSections always gets), so an
//                      example inside a fence never satisfies or trips a
//                      pattern; non-markdown files are untouched
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
//   maxLineLength      { bytes, what, fix } — one finding per file whose lines
//                      run past `bytes` (UTF-8 bytes, so wide characters count
//                      what they cost), anchored at the first over-long line;
//                      {count}/{longest}/{bytes} interpolate
//   skipLinesMatching  RegExp — lines it matches are invisible to matchLines
//   matchLines         [{ match, andLineMatches, unlessLineMatches,
//                         unlessPreviousLineMatches, whenPathMatches,
//                         whenFileMatches, unlessFileMatches, what, fix }]
//                      flag each line `match` hits — provided `andLineMatches`
//                      (if declared) also hits it, `unlessLineMatches` does
//                      not, and `unlessPreviousLineMatches` does not hit the
//                      line above (the first line has none) — in files whose
//                      path matches `whenPathMatches` (absent = every scanned
//                      file), where every `whenFileMatches` matches the text
//                      and `unlessFileMatches` does not; per line, the first
//                      matching assertion wins
//   countMatchingLines [{ linesMatching, atLeast, atMost, what, fix }]
//                      per file, the number of lines `linesMatching` hits must
//                      sit within the declared bounds (at least one bound;
//                      atMost: 0 forbids the pattern); too many anchors at the
//                      first line past atMost, too few at the file;
//                      {count}/{atLeast}/{atMost} interpolate
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
//   requireIndexCoverage [{ eachTrackedPathMatching | eachScannedPathMatching
//                         (+ includeVendored: true to widen scanned to
//                         ctx.allFiles), indexFile,
//                         coveredByText | coveredByGlobLinesMatching,
//                         whenIndexFileAbsent, anchorFindingsAt, what, fix }]
//                      every path the quantifier's RegExp matches must be
//                      covered in `indexFile`: by containing the filled
//                      `coveredByText` template, or — full path or basename —
//                      by the first-token glob of some non-comment index line
//                      `coveredByGlobLinesMatching` matches. The divergent
//                      semantics are declared, never defaulted:
//                      whenIndexFileAbsent = "assertNothing" | "flagEveryPath",
//                      anchorFindingsAt = "indexFile" (deduped, sorted) |
//                      "eachUncoveredPath"
//
// The structured-data assertions read PARSED documents — `.json` via JSON.parse,
// `.yaml`/`.yml` via the minimal YAML parser — each file parsed at most once per
// scan, shared by every rule; an absent or unparsable document asserts nothing.
// A field path is dot-separated (`devDependencies.esbuild`), and a field counts
// as present when its value is not undefined:
//   checkParsedFiles   [{ file | filesMatching (+ whereFileContains),
//                         forEachEntryAtField, whereEntryFieldEquals:
//                           { field, equals },
//                         whenFieldPresent,
//                         requireField, forbidField,
//                         forbidValueInArray: { atField, value, ignoreCase },
//                         requireEqualFields: { field, inFile, atField,
//                           whenFileMissing, whenUnequal },
//                         what, fix }]
//                      the select-then-assert family: pick documents (one
//                      exact `file`, or every tracked file `filesMatching`
//                      whose text matches `whereFileContains`), optionally
//                      quantify over the named entries of the object at
//                      `forEachEntryAtField` (kept where `whereEntryFieldEquals`
//                      holds; {entry} interpolates), gate on `whenFieldPresent`,
//                      then assert: `requireField` present / `forbidField`
//                      absent / the array at `forbidValueInArray.atField` free
//                      of the value / the base's `field` equal to `inFile`'s
//                      `atField` (an absent `inFile` fires `whenFileMissing` at
//                      its path; a mismatch fires `whenUnequal` with
//                      {first}/{second})
//   checkKeyValueFile  [{ file, keys, whenMissing, whenLineNotKeyValue,
//                         whenKeyUnknown, whenKeyMissing }]
//                      the dotenv-style file must exist, hold only KEY=value
//                      lines and # comments, use only the declared keys, and
//                      declare every one; {key}/{keys}/{line} interpolate
//
// The reference-barrier assertion — a directed folder-access graph enforced by
// the reference-scanning engine (helpers/reference-scanning.mjs, which owns the
// edge vocabulary's semantics):
//   forbidReferences   [{ from | between | siblings, to, scope, allow, except,
//                         matchNames, alsoMatchNames, matchUniqueFilenames,
//                         reason }]
//                      each entry one barrier edge, normalized at load (a
//                      malformed edge is an authoring error); the rule's
//                      failureMessage is the why (an edge's `reason` overrides
//                      it), and a rule-level `fix` replaces the engine's
//                      composed crossing remedy
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
//
// LEGACY SPELLINGS, accepted but not for new declarations (a member's own
// local packs may carry them, and a key rename has no fleet carrier):
// checkParsedFile / forEachParsedEntry / equalParsedValues load as
// checkParsedFiles entries, listedInFile / coveredByGlobLine as
// requireIndexCoverage entries — see normalizeLegacySpellings.

const REGISTRY = [];
const scans = new WeakMap();

// The named file sets scanFileClasses/excludeFileClasses may reference —
// shared here so every declaration means the same thing by "test files".
const FILE_CLASSES = {
  javascriptFiles: /\.(mjs|cjs|jsx?|mts|cts|tsx?)$/,
  pythonFiles: /\.py$/,
  markdownFiles: /\.md$/,
  workflowFiles: /^\.github\/workflows\/[^/]+\.ya?ml$/,
  testFiles: /(^|\/)(tests?|__tests__|__mocks__|spec|fixtures?)\/|\.(test|spec)\.|_test\.[a-z]+$/,
};

const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (whole, key) => (key in vars ? String(vars[key]) : whole));
const excludedByOne = (path, exclude) =>
  exclude != null && (exclude instanceof RegExp ? exclude.test(path) : path === exclude);
const excluded = (path, exclude) =>
  Array.isArray(exclude) ? exclude.some((e) => excludedByOne(path, e)) : excludedByOne(path, exclude);

// --- spec-key validation ------------------------------------------------------
// Every container key's allowed children. A key absent from this table is a
// leaf (its value is never descended into); an unknown key inside a listed
// container throws at load, so a typo cannot silently assert nothing.
const MSG = ['what', 'fix'];
const SPEC_KEYS = {
  spec: ['id', 'severity', 'failureMessage', 'fix', 'scanFiles', 'scanTracked', 'excludeFiles',
    'scanFileClasses', 'excludeFileClasses', 'scanIgnoringComments', 'scanIgnoringMarkdownFences',
    'relevantWhen', 'whenMissing',
    'maxLines', 'maxLineLength', 'skipLinesMatching', 'matchLines', 'countMatchingLines',
    'checkEachFile', 'repoWide', 'requirePaths',
    'requireIndexCoverage', 'checkParsedFiles', 'forbidReferences',
    'listedInFile', 'coveredByGlobLine', 'checkParsedFile', 'equalParsedValues',
    'forEachParsedEntry', 'checkKeyValueFile', 'checkSections'],
  checkParsedFiles: ['file', 'filesMatching', 'whereFileContains', 'forEachEntryAtField',
    'whereEntryFieldEquals', 'whenFieldPresent', 'requireField', 'forbidField',
    'forbidValueInArray', 'requireEqualFields', ...MSG],
  whereEntryFieldEquals: ['field', 'equals'],
  requireEqualFields: ['field', 'inFile', 'atField', 'whenFileMissing', 'whenUnequal'],
  whenFileMissing: MSG,
  requireIndexCoverage: ['eachTrackedPathMatching', 'eachScannedPathMatching', 'includeVendored',
    'indexFile', 'coveredByText', 'coveredByGlobLinesMatching', 'whenIndexFileAbsent',
    'anchorFindingsAt', ...MSG],
  forbidReferences: ['from', 'to', 'between', 'siblings', 'scope', 'allow', 'except',
    'matchNames', 'alsoMatchNames', 'matchUniqueFilenames', 'reason'],
  except: ['path', 'to', 'reason'],
  relevantWhen: ['pathExists', 'pathAbsent', 'trackedFileMatches', 'noTrackedFileMatches',
    'exactlyOneTrackedFileMatches', 'someTrackedFileContains', 'scanningWholeRepo', 'repoContains'],
  someTrackedFileContains: ['pathMatching', 'text'],
  whenMissing: MSG,
  maxLines: ['limit', ...MSG],
  maxLineLength: ['bytes', ...MSG],
  matchLines: ['match', 'andLineMatches', 'unlessLineMatches', 'unlessPreviousLineMatches',
    'whenPathMatches', 'whenFileMatches', 'unlessFileMatches', ...MSG],
  countMatchingLines: ['linesMatching', 'atLeast', 'atMost', ...MSG],
  checkEachFile: ['relevantWhen', 'whenFileMatches', 'require', 'forbid', ...MSG],
  repoWide: ['unlessSomeFileMatches', 'flagFilesMatching', 'neverFlagFiles', ...MSG],
  requirePaths: ['path', ...MSG],
  listedInFile: ['eachTrackedPathMatching', 'listFile', 'asText', ...MSG],
  coveredByGlobLine: ['eachPathMatching', 'includeVendored', 'globFile', 'globLineMatching', ...MSG],
  checkParsedFile: ['file', 'whenFieldPresent', 'requireField', 'forbidField', ...MSG],
  equalParsedValues: ['first', 'second', 'whenSecondMissing', 'whenUnequal'],
  first: ['file', 'filesMatching', 'whereFileContains', 'field'],
  second: ['file', 'field'],
  whenSecondMissing: MSG,
  whenUnequal: MSG,
  forEachParsedEntry: ['inFilesMatching', 'entriesAtField', 'whereFieldEquals', 'forbidValueInArray', ...MSG],
  whereFieldEquals: ['field', 'equals'],
  forbidValueInArray: ['atField', 'value', 'ignoreCase'],
  checkKeyValueFile: ['file', 'keys', 'whenMissing', 'whenLineNotKeyValue', 'whenKeyUnknown', 'whenKeyMissing'],
  whenLineNotKeyValue: MSG,
  whenKeyUnknown: MSG,
  whenKeyMissing: MSG,
  checkSections: ['section', 'sections', 'requirePresent', 'requireFirstOnPage', 'forbidProseLines',
    'eachBulletBlockMatches', 'eachBulletLeadsWithDate', 'minBullets', 'maxBullets',
    'maxBulletBlockLength', 'newestDatedBulletWithinDays'],
  requirePresent: MSG,
  requireFirstOnPage: MSG,
  forbidProseLines: MSG,
  eachBulletBlockMatches: ['pattern', ...MSG],
  eachBulletLeadsWithDate: ['whenUndated', 'whenNotRealDate'],
  whenUndated: MSG,
  whenNotRealDate: MSG,
  minBullets: ['count', ...MSG],
  maxBullets: ['count', ...MSG],
  maxBulletBlockLength: ['characters', ...MSG],
  newestDatedBulletWithinDays: ['days', ...MSG],
};

function validateSpecKeys(value, containerKey, where) {
  if (Array.isArray(value)) { for (const v of value) validateSpecKeys(v, containerKey, where); return; }
  const allowed = SPEC_KEYS[containerKey];
  if (!allowed || value === null || typeof value !== 'object' || value instanceof RegExp) return;
  for (const [k, v] of Object.entries(value)) {
    if (!allowed.includes(k)) {
      throw new Error(containerKey === 'spec'
        ? `${where}: "${k}" is not a spec key — the vocabulary here is: ${allowed.join(', ')}`
        : `${where}: "${k}" is not a key of "${containerKey}" — its keys are: ${allowed.join(', ')}`);
    }
    validateSpecKeys(v, k, where);
  }
}

// The LEGACY SPELLINGS of the two merged assertion families, normalized into
// their merged forms here so the runtime knows only those. They stay accepted
// because declared-checks.json is a contract a member's own local packs may
// already use, and a key rename has no fleet carrier — but new declarations
// spell the merged keys.
//   checkParsedFile / forEachParsedEntry / equalParsedValues → checkParsedFiles
//   listedInFile / coveredByGlobLine                         → requireIndexCoverage
function normalizeLegacySpellings(spec) {
  const parsed = [...(spec.checkParsedFiles ?? []), ...(spec.checkParsedFile ?? [])];
  for (const a of spec.forEachParsedEntry ?? []) {
    parsed.push({
      filesMatching: a.inFilesMatching, forEachEntryAtField: a.entriesAtField,
      whereEntryFieldEquals: a.whereFieldEquals, forbidValueInArray: a.forbidValueInArray,
      what: a.what, fix: a.fix,
    });
  }
  for (const a of spec.equalParsedValues ?? []) {
    parsed.push({
      ...(a.first.file !== undefined ? { file: a.first.file }
        : { filesMatching: a.first.filesMatching, whereFileContains: a.first.whereFileContains }),
      requireEqualFields: {
        field: a.first.field, inFile: a.second.file, atField: a.second.field,
        whenFileMissing: a.whenSecondMissing, whenUnequal: a.whenUnequal,
      },
    });
  }
  if (parsed.length) spec.checkParsedFiles = parsed;
  delete spec.checkParsedFile;
  delete spec.forEachParsedEntry;
  delete spec.equalParsedValues;

  const coverage = [...(spec.requireIndexCoverage ?? [])];
  for (const a of spec.listedInFile ?? []) {
    coverage.push({
      eachTrackedPathMatching: a.eachTrackedPathMatching, indexFile: a.listFile,
      coveredByText: a.asText, whenIndexFileAbsent: 'assertNothing',
      anchorFindingsAt: 'indexFile', what: a.what, fix: a.fix,
    });
  }
  for (const a of spec.coveredByGlobLine ?? []) {
    coverage.push({
      eachScannedPathMatching: a.eachPathMatching, includeVendored: a.includeVendored,
      indexFile: a.globFile, coveredByGlobLinesMatching: a.globLineMatching,
      whenIndexFileAbsent: 'flagEveryPath', anchorFindingsAt: 'eachUncoveredPath',
      what: a.what, fix: a.fix,
    });
  }
  if (coverage.length) spec.requireIndexCoverage = coverage;
  delete spec.listedInFile;
  delete spec.coveredByGlobLine;
}

// Shape rules the key table can't state: each merged-family entry needs exactly
// one selector, at least one assertion, and closed-vocabulary mode values; a
// count entry needs its pattern and a coherent bound.
function validateEntryShapes(spec, where) {
  for (const a of spec.countMatchingLines ?? []) {
    if (!(a.linesMatching instanceof RegExp)) {
      throw new Error(`${where}: a countMatchingLines entry needs "linesMatching", the pattern it counts`);
    }
    const bounds = [a.atLeast, a.atMost].filter((b) => b !== undefined);
    if (!bounds.length) {
      throw new Error(`${where}: a countMatchingLines entry needs a bound — "atLeast", "atMost", or both`);
    }
    if (bounds.some((b) => !Number.isInteger(b) || b < 0)) {
      throw new Error(`${where}: countMatchingLines bounds ("atLeast"/"atMost") are whole numbers of lines`);
    }
    if (a.atLeast !== undefined && a.atMost !== undefined && a.atLeast > a.atMost) {
      throw new Error(`${where}: countMatchingLines declares "atLeast" above "atMost" — no count can satisfy it`);
    }
  }
  for (const a of spec.checkParsedFiles ?? []) {
    if ((a.file === undefined) === (a.filesMatching === undefined)) {
      throw new Error(`${where}: a checkParsedFiles entry selects by exactly one of "file" or "filesMatching"`);
    }
    if (a.whereFileContains && a.filesMatching === undefined) {
      throw new Error(`${where}: "whereFileContains" refines "filesMatching" and cannot go with "file"`);
    }
    if (!a.requireField && !a.forbidField && !a.forbidValueInArray && !a.requireEqualFields) {
      throw new Error(`${where}: a checkParsedFiles entry asserts nothing — add requireField, forbidField, forbidValueInArray, or requireEqualFields`);
    }
  }
  for (const a of spec.requireIndexCoverage ?? []) {
    if ((a.eachTrackedPathMatching === undefined) === (a.eachScannedPathMatching === undefined)) {
      throw new Error(`${where}: a requireIndexCoverage entry quantifies by exactly one of "eachTrackedPathMatching" or "eachScannedPathMatching"`);
    }
    if ((a.coveredByText === undefined) === (a.coveredByGlobLinesMatching === undefined)) {
      throw new Error(`${where}: a requireIndexCoverage entry declares exactly one coverage form — "coveredByText" or "coveredByGlobLinesMatching"`);
    }
    if (a.whenIndexFileAbsent !== 'assertNothing' && a.whenIndexFileAbsent !== 'flagEveryPath') {
      throw new Error(`${where}: "whenIndexFileAbsent" must be "assertNothing" or "flagEveryPath" — the divergent case is declared, never defaulted`);
    }
    if (a.anchorFindingsAt !== 'indexFile' && a.anchorFindingsAt !== 'eachUncoveredPath') {
      throw new Error(`${where}: "anchorFindingsAt" must be "indexFile" or "eachUncoveredPath"`);
    }
  }
}

// Rule-level `fix` inherited by every assertion that declares `what` without a
// `fix` of its own; the message-shaped sub-objects (whenMissing, whenUndated, …)
// inherit the same way, since they are what/fix pairs too.
function applyFixDefault(value, fix) {
  if (Array.isArray(value)) { for (const v of value) applyFixDefault(v, fix); return; }
  if (value === null || typeof value !== 'object' || value instanceof RegExp) return;
  if (typeof value.what === 'string' && value.fix === undefined) value.fix = fix;
  for (const [k, v] of Object.entries(value)) {
    if (k !== 'what' && k !== 'fix') applyFixDefault(v, fix);
  }
}

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

// Fenced code blocks blanked line-for-line, so line numbers never shift — the
// view markdownIndex always reads, and the one scanIgnoringMarkdownFences
// hands the content assertions.
function blankMarkdownFences(text) {
  let inFence = false;
  return text.split('\n').map((l) => {
    if (/^\s*(```|~~~)/.test(l)) { inFence = !inFence; return ''; }
    return inFence ? '' : l;
  }).join('\n');
}

// One parse of a page's section structure, shared by every subscribing rule:
// fenced lines blanked, the first `## ` heading, and each named section's body
// ({ line, text } entries, 1-indexed) memoized per name.
function markdownIndex(text) {
  const stripped = blankMarkdownFences(text).split('\n');
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

  // Index coverage: every selected path must be covered in the index file —
  // by its filled coveredByText token, or by the first-token glob of some
  // non-comment index line coveredByGlobLinesMatching selects (full path or
  // basename). Absence handling and anchoring are declared per entry, never
  // defaulted, because the two families this merged genuinely diverged there.
  for (const a of s.requireIndexCoverage ?? []) {
    const indexText = ctx.read(a.indexFile);
    if (indexText === null && a.whenIndexFileAbsent === 'assertNothing') continue;
    const globs = a.coveredByGlobLinesMatching === undefined ? [] : (indexText ?? '').split('\n')
      .filter((line) => a.coveredByGlobLinesMatching.test(line) && !line.trim().startsWith('#'))
      .map((line) => globToRe(line.trim().split(/\s+/)[0]));
    const matcher = a.eachTrackedPathMatching ?? a.eachScannedPathMatching;
    const paths = a.eachTrackedPathMatching ? ctx.tracked
      : (a.includeVendored ? ctx.allFiles : ctx.files);
    const atIndex = new Map();
    for (const path of paths) {
      const m = matcher.exec(path);
      if (!m) continue;
      const vars = { path, ...(m.groups ?? {}) };
      let covered;
      let dedupKey;
      if (a.coveredByText !== undefined) {
        const token = fill(a.coveredByText, vars);
        covered = indexText !== null && indexText.includes(token);
        dedupKey = token;
      } else {
        const base = path.slice(path.lastIndexOf('/') + 1);
        covered = globs.some((re) => re.test(path) || re.test(base));
        dedupKey = path;
      }
      if (covered) continue;
      if (a.anchorFindingsAt === 'indexFile') {
        if (!atIndex.has(dedupKey)) atIndex.set(dedupKey, vars);
      } else {
        j.out.push(finding(j.rule, { file: path, what: fill(a.what, vars), fix: fill(a.fix, vars) }));
      }
    }
    for (const [, vars] of [...atIndex].sort(([k1], [k2]) => k1.localeCompare(k2))) {
      j.out.push(finding(j.rule, { file: a.indexFile, what: fill(a.what, vars), fix: fill(a.fix, vars) }));
    }
  }
}

// The structured-data assertions — they read a few named or tracked documents
// through the scan's shared parse cache, so like the tree assertions they run
// directly per rule rather than riding the content pass.
function assertParsedShape(ctx, j, parsed) {
  const s = j.spec;

  // The merged select-then-assert family: pick documents (one exact file, or
  // every tracked file matching), optionally quantify over the named entries
  // of the object at forEachEntryAtField, then run every declared assertion
  // against each selected base object. An absent or unparsable document
  // asserts nothing, as everywhere in the parsed family.
  for (const a of s.checkParsedFiles ?? []) {
    const paths = a.file !== undefined ? [a.file]
      : ctx.tracked.filter((f) =>
        a.filesMatching.test(f) && (!a.whereFileContains || a.whereFileContains.test(ctx.read(f) ?? '')));
    for (const path of paths) {
      const doc = parsed(path);
      if (doc == null) continue;
      let bases;
      if (a.forEachEntryAtField) {
        const entries = fieldAt(doc, a.forEachEntryAtField);
        if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue;
        bases = Object.entries(entries).filter(([, entry]) => entry && typeof entry === 'object');
        if (a.whereEntryFieldEquals) {
          bases = bases.filter(([, entry]) =>
            fieldAt(entry, a.whereEntryFieldEquals.field) === a.whereEntryFieldEquals.equals);
        }
      } else {
        bases = [[null, doc]];
      }
      for (const [entryName, base] of bases) {
        if (a.whenFieldPresent && fieldAt(base, a.whenFieldPresent) === undefined) continue;
        const vars = { path, ...(entryName === null ? {} : { entry: entryName }) };
        const flag = (what, fix, at = path, extraVars = {}) => j.out.push(finding(j.rule, {
          file: at, what: fill(what, { ...vars, ...extraVars }), fix: fill(fix, { ...vars, ...extraVars }),
        }));
        if (a.requireField && fieldAt(base, a.requireField) === undefined) flag(a.what, a.fix);
        if (a.forbidField && fieldAt(base, a.forbidField) !== undefined) flag(a.what, a.fix);
        if (a.forbidValueInArray) {
          const values = fieldAt(base, a.forbidValueInArray.atField);
          const norm = (v) => (a.forbidValueInArray.ignoreCase ? String(v).toLowerCase() : String(v));
          if (Array.isArray(values) && values.some((v) => norm(v) === norm(a.forbidValueInArray.value))) {
            flag(a.what, a.fix);
          }
        }
        if (a.requireEqualFields) {
          const eq = a.requireEqualFields;
          if (ctx.read(eq.inFile) === null) {
            flag(eq.whenFileMissing.what, eq.whenFileMissing.fix, eq.inFile);
          } else {
            const targetDoc = parsed(eq.inFile);
            if (targetDoc != null) {
              const pair = { first: fieldAt(base, eq.field), second: fieldAt(targetDoc, eq.atField) };
              if (pair.first !== pair.second) flag(eq.whenUnequal.what, eq.whenUnequal.fix, path, pair);
            }
          }
        }
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

// A declared check's barrier edges (forbidReferences, normalized at load into
// spec.edges): the reference-scanning engine finds the crossings, the rule's
// failureMessage is the why (an edge's own `reason` overrides it per finding),
// and a rule-level `fix` replaces the engine's composed remedy on every
// crossing finding — the structural fail-closed findings (an empty glob
// expansion) keep their own texts. Stale reviewed-exception findings are
// judged only on a whole-repo sweep, as everywhere the staleness test runs.
function assertReferenceEdges(ctx, j) {
  const { findings, stale } = barrierFindings(ctx, j.spec.edges, j.rule);
  const scanErrors = findings.some((f) => f.resolved === undefined);
  j.out.push(...(j.spec.fix === undefined ? findings
    : findings.map((f) => (f.resolved === undefined ? f : { ...f, fix: j.spec.fix }))));
  if (ctx.mode === 'all' && !scanErrors) j.out.push(...staleFindings(stale, j.rule));
}

// One file visited once for every subscribing rule: whole-text assertions and
// repo-wide bookkeeping first, then a single walk of the lines shared by all
// the rules' line assertions. A rule's scanIgnoring* keys pick its VIEW of the
// same file — comments blanked, markdown fences blanked, or both — each view
// computed at most once per visit; every blanking preserves line count, so all
// views' line numbers agree and the markdown-section index stays on the raw
// text (whose fences markdownIndex already blanks itself).
function visit(ctx, subs, path, text) {
  const fenced = FILE_CLASSES.markdownFiles.test(path);
  const viewKey = (j) => (j.spec.scanIgnoringComments ? 'c' : '') +
    (j.spec.scanIgnoringMarkdownFences && fenced ? 'f' : '');
  const textViews = new Map();
  const lineViews = new Map();
  const textFor = (j) => {
    const key = viewKey(j);
    if (!textViews.has(key)) {
      let t = text;
      if (key.includes('c')) t = stripComments(t);
      if (key.includes('f')) t = blankMarkdownFences(t);
      textViews.set(key, t);
    }
    return textViews.get(key);
  };
  const linesFor = (j) => {
    const key = viewKey(j);
    if (!lineViews.has(key)) lineViews.set(key, textFor(j).split('\n'));
    return lineViews.get(key);
  };
  const RAW = { spec: {} };
  const lines = () => linesFor(RAW);
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
    if (s.maxLineLength) {
      const a = s.maxLineLength;
      const over = linesFor(j)
        .map((ln, i) => ({ n: i + 1, bytes: Buffer.byteLength(ln) }))
        .filter((l) => l.bytes > a.bytes);
      if (over.length) {
        const vars = { count: over.length, bytes: a.bytes, longest: Math.max(...over.map((l) => l.bytes)) };
        j.out.push(finding(j.rule, {
          file: path, line: over[0].n, what: fill(a.what, vars), fix: fill(a.fix, vars),
        }));
      }
    }
    for (const a of s.countMatchingLines ?? []) {
      const view = linesFor(j);
      let count = 0;
      let overflowAt = null;
      for (let i = 0; i < view.length; i++) {
        if (!a.linesMatching.test(view[i])) continue;
        count += 1;
        if (overflowAt === null && a.atMost !== undefined && count === a.atMost + 1) overflowAt = i + 1;
      }
      const under = a.atLeast !== undefined && count < a.atLeast;
      if (!under && overflowAt === null) continue;
      const vars = { count,
        ...(a.atLeast !== undefined ? { atLeast: a.atLeast } : {}),
        ...(a.atMost !== undefined ? { atMost: a.atMost } : {}) };
      j.out.push(finding(j.rule, {
        file: path, ...(under ? {} : { line: overflowAt }),
        what: fill(a.what, vars), fix: fill(a.fix, vars),
      }));
    }
    for (const a of s.checkEachFile ?? []) {
      if (a.relevantWhen && !relevant(ctx, a.relevantWhen)) continue;
      if (!arr(a.whenFileMatches).every((re) => re.test(textFor(j)))) continue;
      if (a.forbid ? a.forbid.test(textFor(j)) : !a.require.test(textFor(j))) {
        j.out.push(finding(j.rule, { file: path, what: a.what, fix: a.fix }));
      }
    }
    for (const st of j.repoStates) {
      if (st.a.unlessSomeFileMatches.test(textFor(j))) st.satisfied = true;
      if (excluded(path, st.a.neverFlagFiles)) continue;
      const group = st.a.flagFilesMatching.find((g) => g.every((re) => re.test(textFor(j))));
      if (group) {
        const at = linesFor(j).findIndex((ln) => group[0].test(ln));
        st.hits.push({ file: path, line: at === -1 ? null : at + 1, what: st.a.what, fix: st.a.fix });
      }
    }
    const eligible = (s.matchLines ?? []).filter((a) =>
      (!a.whenPathMatches || a.whenPathMatches.test(path)) &&
      arr(a.whenFileMatches).every((re) => re.test(textFor(j))) && !a.unlessFileMatches?.test(textFor(j)));
    if (eligible.length) lineJobs.push({ j, eligible, viewLines: linesFor(j) });
  }

  if (!lineJobs.length) return;
  for (let i = 0; i < lines().length; i++) {
    for (const { j, eligible, viewLines } of lineJobs) {
      const ln = viewLines[i];
      if (j.spec.skipLinesMatching?.test(ln)) continue;
      for (const a of eligible) {
        const m = ln.match(a.match);
        if (!m || (a.andLineMatches && !a.andLineMatches.test(ln)) || a.unlessLineMatches?.test(ln)) continue;
        if (a.unlessPreviousLineMatches && i > 0 && a.unlessPreviousLineMatches.test(viewLines[i - 1])) continue;
        const vars = { match: m[0] };
        j.out.push(finding(j.rule, {
          file: path, line: i + 1, what: fill(a.what, vars), fix: fill(a.fix, vars),
        }));
        break;
      }
    }
  }
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
    if (j.spec.edges) assertReferenceEdges(ctx, j);
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

  const swept = jobs.filter((j) => j.spec.scanMatchers.length);
  if (swept.length) {
    const scanned = new Set(ctx.files);
    const tracked = new Set(ctx.tracked);
    for (const path of [...ctx.files, ...ctx.tracked.filter((f) => !scanned.has(f))]) {
      const subs = swept.filter((j) =>
        (j.spec.scanTracked ? tracked : scanned).has(path) &&
        j.spec.scanMatchers.some((re) => re.test(path)) && !excluded(path, j.spec.excludeMatchers));
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
        !ctx.files.some((f) => !excluded(f, j.spec.excludeMatchers) && marker.test(ctx.read(f) ?? ''))) {
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
  'skipLinesMatching', 'match', 'andLineMatches', 'unlessLineMatches',
  'unlessPreviousLineMatches', 'whenPathMatches', 'whenFileMatches', 'unlessFileMatches',
  'require', 'forbid', 'trackedFileMatches', 'noTrackedFileMatches', 'exactlyOneTrackedFileMatches',
  'pathMatching', 'text', 'repoContains', 'unlessSomeFileMatches', 'flagFilesMatching',
  'neverFlagFiles', 'eachTrackedPathMatching', 'eachPathMatching', 'globLineMatching',
  'filesMatching', 'whereFileContains', 'inFilesMatching', 'pattern', 'linesMatching',
  'eachScannedPathMatching', 'coveredByGlobLinesMatching',
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

export function patternRule(declaration, { selfExclude = null } = {}) {
  const where = `the declared check "${declaration.id}"`;
  if (typeof declaration.id !== 'string' || !declaration.id.trim()) {
    throw new Error('a declared check needs a non-empty "id"');
  }
  if (declaration.severity !== 'blocking' && declaration.severity !== 'advisory') {
    throw new Error(`${where}: severity must be "blocking" or "advisory", not ${JSON.stringify(declaration.severity)}`);
  }
  validateSpecKeys(declaration, 'spec', where);
  const spec = compileSpec(declaration, null, where);
  normalizeLegacySpellings(spec);
  validateEntryShapes(spec, where);
  const classPatterns = (names) => (names ?? []).map((n) => {
    if (!FILE_CLASSES[n]) {
      throw new Error(`${where}: "${n}" is not a file class — the classes are: ${Object.keys(FILE_CLASSES).join(', ')}`);
    }
    return FILE_CLASSES[n];
  });
  const scanClasses = classPatterns(spec.scanFileClasses);
  if (scanClasses.length && typeof spec.scanFiles === 'string') {
    throw new Error(`${where}: scanFileClasses cannot combine with an exact-path scanFiles`);
  }
  // The normalized selection surface the scan reads: the sweep patterns
  // (regex scanFiles + classes) and every exclusion (declared, class-named,
  // and the loader-supplied self-exclusion) as flat lists.
  spec.scanMatchers = [...(spec.scanFiles instanceof RegExp ? [spec.scanFiles] : []), ...scanClasses];
  spec.excludeMatchers = [
    ...(spec.excludeFiles != null ? [spec.excludeFiles] : []),
    ...classPatterns(spec.excludeFileClasses),
    ...(selfExclude ? [selfExclude] : []),
  ];
  if (typeof spec.fix === 'string') applyFixDefault(spec, spec.fix);
  if (spec.forbidReferences !== undefined) {
    const { edges, errors } = normalizeEdges(spec.forbidReferences);
    if (errors.length) throw new Error(`${where}: ${errors[0].what} — ${errors[0].fix}`);
    spec.edges = edges;
  }
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
//
// A SKILL's declarations (a dir named `…/skills/<name>`) are compiled with a
// structural self-exclusion — content under any `skills/<name>/` path segment
// pair is out of every assertion's scope — so a skill's own SKILL.md examples
// never trip its checks, in whichever tree the skill's content appears (the
// canon's packs/<pack>/skills/, a root skills/ layout, a consumer's mounted
// .claude/skills/ links), without each declaration hand-spelling the exclusion.
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
    const skillName = /(^|[\\/])skills[\\/]([^\\/]+)$/.exec(dir)?.[2];
    const selfExclude = skillName ? new RegExp(`(^|/)skills/${escapeRe(skillName)}/`) : null;
    loaded.set(path, specs.map((s) => patternRule(s, { selfExclude })));
  }
  return loaded.get(path);
}
