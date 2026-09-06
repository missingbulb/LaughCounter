// What every per-call hook reads before it can judge anything: the project's
// declared packs and rule overrides, and — derived from the active packs — the
// skill triggers (path, tool-call, prompt, result) and the action declarations.
// One reader, so the PreToolUse, UserPromptSubmit and PostToolUse judges cannot
// disagree about which packs are active or what they declare; one cache, so a
// hook that runs on every tool call pays the registry load once per session
// rather than once per call (`hookContext` below), and one transcript reader,
// parsed only when a trigger actually names the call (`sessionReader`).
import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hooklog } from '../checks/helpers/hook-log.mjs';
import { parseEntries, sessionTranscriptPaths, skillLoads, toolCalls } from '../checks/helpers/session-transcript.mjs';
import { settingsPath } from '../settings-file.mjs';

// This module lives at <corpus>/engine/hooks/ — the same root the mount hook
// resolves the registry from, so the canon runs it from its own tree.
export const corpusRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

// The raw settings: the declared packs (what activates) and the per-rule
// overrides (off / advisory / blocking), project-wide and per pack entry.
export function readSettings(projectRoot) {
  const path = settingsPath(projectRoot);
  if (!existsSync(path)) return { packs: [], rules: {} };
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const rules = { ...(raw.rules ?? {}) };
  for (const entry of Array.isArray(raw.packs) ? raw.packs : []) {
    if (entry && typeof entry === 'object') Object.assign(rules, entry.rules ?? {});
  }
  return { packs: Array.isArray(raw.packs) ? raw.packs : [], rules };
}

export async function activePacks(projectRoot, declared) {
  const { loadPacks, isActive } = await import(join(corpusRoot, 'engine', 'pack_loader', 'pack-registry.mjs'));
  const packs = await loadPacks({ localRoot: projectRoot });
  return packs.filter((p) => isActive(p, { packs: declared }));
}

export function transcriptEntries(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return [];
  try { return parseEntries(readFileSync(transcriptPath, 'utf8')); } catch { return []; }
}

export const loadedSkills = (transcriptPath) => skillLoads(sessionEntries(transcriptPath));

// Every entry the session wrote, its subagents' streams included — a payload
// names the session file whichever agent is calling, so a guard reading that
// file alone sees neither a subagent's load nor its calls (session-transcript.mjs
// states the layout).
export const sessionEntries = (transcriptPath) =>
  sessionTranscriptPaths(transcriptPath).flatMap(transcriptEntries);

// The session transcript, read at most once per hook run and only on demand:
// `loaded()` is the skill names the session has loaded, `calls()` its recorded
// tool calls. A trigger matcher takes `loaded` as a function, so a call no
// trigger names never parses the transcript at all — on a long session that
// parse is the largest single cost a hook has.
export function sessionReader(transcriptPath) {
  let entries = null;
  const read = () => (entries ??= sessionEntries(transcriptPath));
  return { loaded: () => skillLoads(read()), calls: () => toolCalls(read()) };
}

// The one sentence every trigger's block or nudge ends with: how to load the
// skill. Reading the skill's own file is a load too (the transcript reader
// counts it), so the message carries that path beside the Skill call.
export function loadInstruction(missing, projectRoot) {
  const rel = (d) => join(d.dir, 'SKILL.md').replace(`${projectRoot}/`, '').split('\\').join('/');
  return `Skill tool, ${missing.map((d) => `skill: "${d.skill}"`).join(', ')}, or Read ${missing.map(rel).join(' or ')}`;
}

// ---- the cached derivation --------------------------------------------------
//
// `hookContext(projectRoot, event)` → { overrides, scoped, triggered, actionRules,
// source }: the path-scoped skill declarations, the triggered-skill declarations
// and the `scope: "action"` rules of the active packs, plus the settings
// overrides. Deriving them means loading the registry — importing every
// pack.mjs — which dominates a hook's run, so the derivation is memoised in a
// file under the OS temp dir, keyed by the project root, and trusted only while
// a stat fingerprint of everything it was derived from still holds: the settings
// file, the pack scan roots, each active pack's directory, manifest,
// declarations and skills, and the engine modules that do the deriving. Any
// change to any of those — a trigger edited in a SKILL.md, a skill added, a pack
// declared, the engine converged — misses and re-derives; a cache that cannot be
// read or written is a miss too, never a failure. `source` says which path ran,
// and the miss path logs itself, so a hook that keeps re-deriving is visible in
// the hook log rather than only slow.
export const CACHE_VERSION = 1;

const ENGINE_INPUTS = [
  'engine/pack_loader/pack-registry.mjs', 'engine/pack_loader/pack-conventions.mjs',
  'engine/pack_loader/pack-schema.mjs', 'engine/pack_loader/skill-frontmatter.mjs',
  'engine/pack_loader/path-scoped-skills.mjs', 'engine/pack_loader/renamed-packs.mjs',
  'engine/checks/helpers/pattern-rules.mjs', 'engine/checks/run-active-pack-rules.mjs',
  'engine/hooks/hook-context.mjs',
];

export const cacheFile = (projectRoot) =>
  join(tmpdir(), 'claudinite-hooks', `${createHash('sha1').update(resolve(projectRoot)).digest('hex').slice(0, 20)}.json`);

// A stat entry per input: [path, mtimeMs, size] for a file, size -1 for a
// directory (whose mtime moves when an entry is added, removed or renamed),
// nulls for a path that does not exist — absence is a state the fingerprint
// holds too, so a file appearing later misses.
function stamp(path) {
  try { const s = statSync(path); return [path, s.mtimeMs, s.isDirectory() ? -1 : s.size]; }
  catch { return [path, null, null]; }
}
const holds = (entries) => Array.isArray(entries) && entries.every((e) => {
  const now = stamp(e[0]);
  return now[1] === e[1] && now[2] === e[2];
});

// RegExps survive the JSON round trip as `{ $re, $flags }` — generic, so a new
// regex-carrying key in a declaration needs nothing here.
const replacer = (k, v) => (v instanceof RegExp ? { $re: v.source, $flags: v.flags } : v);
const reviver = (k, v) => (v && typeof v === 'object' && typeof v.$re === 'string' ? new RegExp(v.$re, v.$flags ?? '') : v);

function readCache(file) {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'), reviver);
    if (raw?.version !== CACHE_VERSION || !holds(raw.fingerprint)) return null;
    return raw.derived;
  } catch { return null; }
}

function writeCache(file, record) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(tmp, JSON.stringify(record, replacer));
    renameSync(tmp, file);
  } catch {
    try { unlinkSync(tmp); } catch { /* nothing to clean */ }
  }
}

async function derive(projectRoot, declared) {
  const engine = (rel) => import(join(corpusRoot, rel));
  const [{ loadPacks, isActive, localPacksDir }, { pathScopedSkills, triggeredSkills }, { packRules }] = await Promise.all([
    engine('engine/pack_loader/pack-registry.mjs'), engine('engine/pack_loader/path-scoped-skills.mjs'),
    engine('engine/checks/run-active-pack-rules.mjs'),
  ]);
  const packs = (await loadPacks({ localRoot: projectRoot })).filter((p) => isActive(p, { packs: declared }));
  const derived = {
    scoped: pathScopedSkills(packs),
    triggered: triggeredSkills(packs),
    actionRules: packRules(packs).filter((r) => r.scope === 'action'),
  };
  const inputs = [
    settingsPath(projectRoot), join(corpusRoot, 'packs'), localPacksDir(projectRoot),
    ...ENGINE_INPUTS.map((rel) => join(corpusRoot, rel)),
    ...packs.flatMap((p) => [
      p.dir, join(p.dir, 'pack.mjs'), join(p.dir, 'declared-checks.json'), join(p.dir, 'skills'),
      ...(p.skills ?? []).flatMap((s) => [join(p.dir, 'skills', s), join(p.dir, 'skills', s, 'SKILL.md'), join(p.dir, 'skills', s, 'declared-checks.json')]),
    ]),
  ];
  return { derived, fingerprint: inputs.map(stamp) };
}

export async function hookContext(projectRoot, event = 'hook') {
  const { packs: declared, rules: overrides } = readSettings(projectRoot);
  const file = cacheFile(projectRoot);
  const cached = readCache(file);
  if (cached) return { ...cached, overrides, source: 'cache' };
  const { derived, fingerprint } = await derive(projectRoot, declared);
  writeCache(file, { version: CACHE_VERSION, fingerprint, derived });
  hooklog(event, `registry-loaded ${derived.scoped.length} scoped, ${derived.triggered.length} triggered, ${derived.actionRules.length} action rules`);
  // The same shape the cache path returns: through the round trip, so the two
  // paths cannot differ by a field the serialisation drops.
  return { ...JSON.parse(JSON.stringify(derived, replacer), reviver), overrides, source: 'registry' };
}
