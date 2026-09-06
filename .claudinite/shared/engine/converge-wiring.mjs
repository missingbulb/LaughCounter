// Fresh-path wiring convergence (task-code-work DESIGN §7, the primitive absorbed from
// #405). The deterministic half of the self-refresh that has nothing to do with the
// vendored mount's CONTENT: the repo-specific wiring EVERY Claudinite member carries,
// converged idempotently in code so the nightly refresh never needs a model to re-enact
// bootstrap's prose.
//
// DISTRIBUTION WIRING ONLY. What a member needs in order to receive and load pack
// content — the settings hooks, the rules index and the CLAUDE.md import that loads it,
// the mount's git attributes, the repo's own local pack. Scheduling
// wiring is not here: the two workflow files belong to the mechanism that runs them and
// are scaffolded at adoption by the tasks pack (#1317), so a member without that pack
// converges exactly this and nothing about a queue it does not have.
//
// One source of truth: bootstrap Part 5 describes this same set for a fresh adoption;
// this module is what both bootstrap and the update flows CALL, so the wiring can never
// drift between "how a repo is set up" and "how the nightly keeps it set up".
//
// Operates on a repo working tree at `root` with node:fs directly (like
// apply-vendor-set.mjs), returning a summary of what it changed — idempotent: a
// repo already converged produces an empty change list.

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeRulesIndex, RULES_INDEX_FILE, RULES_INDEX_IMPORT } from './pack_loader/generate-rules-index.mjs';
import { writeSkillsIndex, SKILLS_INDEX_FILE } from './pack_loader/generate-skills-index.mjs';
import { LOCAL_PACKS_SUBDIR, LOCAL_DECL_PREFIX, SHARED_SUBDIR } from './pack_loader/pack-registry.mjs';

// The mount's two halves as git wants them spelled: '/' separators, and the shared
// subtree's own name for a pattern written from inside the mount root. SHARED_SUBDIR
// is joined with the platform's separator.
const MOUNT_ROOT = dirname(SHARED_SUBDIR).split(sep).join('/');
const SHARED_NAME = SHARED_SUBDIR.split(sep).pop();
import { settingsPath } from './settings-file.mjs';
import { ENDPOINTS_KEY, LEGACY_ENDPOINTS_KEY } from './checks/helpers/repo-context.mjs';

// The settings-hook registrations a scheduled repo carries (bootstrap Part 5).
// Ensured present without clobbering — a set-union keyed on the command string, so
// a repo's own extra hooks and any hand-added entries survive untouched.
// The PreToolUse guard watches EVERY tool: an active pack's action declaration
// (guardToolCalls) may name any of them, and the guard fast-exits on a call no
// declaration names (engine/hooks/pretooluse-command.mjs).
export const PRETOOLUSE_MATCHER = '.*';

export const REQUIRED_HOOKS = [
  { event: 'SessionStart', matcher: null, command: 'bash $CLAUDE_PROJECT_DIR/.claudinite/shared/engine/hooks/session-start-command.sh' },
  { event: 'Stop', matcher: null, command: 'node $CLAUDE_PROJECT_DIR/.claudinite/shared/engine/hooks/stop-command.mjs' },
  { event: 'PreToolUse', matcher: PRETOOLUSE_MATCHER, command: 'node $CLAUDE_PROJECT_DIR/.claudinite/shared/engine/hooks/pretooluse-command.mjs' },
  { event: 'SessionEnd', matcher: null, command: 'node $CLAUDE_PROJECT_DIR/.claudinite/shared/engine/hooks/session-end-command.mjs' },
  // The two trigger hooks (engine/pack_loader/path-scoped-skills.mjs): an owner
  // prompt or a tool result a skill forces itself for gets the load instruction
  // injected at that moment. PostToolUse, like PreToolUse, watches every tool.
  { event: 'UserPromptSubmit', matcher: null, command: 'node $CLAUDE_PROJECT_DIR/.claudinite/shared/engine/hooks/user-prompt-submit-command.mjs' },
  { event: 'PostToolUse', matcher: '.*', command: 'node $CLAUDE_PROJECT_DIR/.claudinite/shared/engine/hooks/post-tool-use-command.mjs' },
];

export const SETTINGS_PATH = '.claude/settings.json';
export const CLAUDE_MD = 'CLAUDE.md';

// The retired corpus-index import (#385): a line importing `.claudinite/shared/CLAUDE.md`.
// The whole line (and its trailing newline) is removed wherever it appears.
const CORPUS_IMPORT_RE = /^.*@\.claudinite\/shared\/CLAUDE\.md.*\n?/m;

// The project's settings, loaded through the one reader that validates them.
// Dynamic and in one place: the scheduler reaches the checks helpers exactly here,
// so the cross-tree import stays a single, reviewable edge.
const repoConfig = async (root) => (await import('./checks/helpers/repo-context.mjs')).loadConfig(root);

// Ensure the required settings hooks are present (add-if-missing, never clobber).
// Returns { added: [labels], error? }. A malformed settings file is reported, never
// overwritten (the transactional stance — surface it, don't destroy hand config).
export function ensureHooks(root) {
  const path = join(root, SETTINGS_PATH);
  let settings = {};
  if (existsSync(path)) {
    try { settings = JSON.parse(readFileSync(path, 'utf8')); }
    catch { return { added: [], error: `${SETTINGS_PATH} is not valid JSON — left untouched` }; }
  }
  settings.hooks ??= {};
  const added = [];
  for (const h of REQUIRED_HOOKS) {
    const list = (settings.hooks[h.event] ??= []);
    const ours = (group) => (group.hooks ?? []).some((entry) => entry?.command === h.command);
    const present = list.some((group) => (h.matcher == null || group.matcher === h.matcher) && ours(group));
    // The command is the registration's identity: a group already running it under
    // an earlier matcher is retargeted, never joined by a second group that would
    // run the same guard twice on the tools both matchers name.
    const retarget = present ? null : list.find((group) => h.matcher != null && ours(group) && group.matcher !== h.matcher);
    if (retarget) {
      retarget.matcher = h.matcher;
      added.push(`${h.event}[${h.matcher}]`);
    } else if (!present) {
      list.push({ ...(h.matcher != null ? { matcher: h.matcher } : {}), hooks: [{ type: 'command', command: h.command }] });
      added.push(`${h.event}${h.matcher ? `[${h.matcher}]` : ''}`);
    }
  }
  if (added.length) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(settings, null, 2) + '\n');
  }
  return { added };
}

// Remove the retired `@.claudinite/shared/CLAUDE.md` corpus-index import (#385) from
// the repo's CLAUDE.md. Returns true when a line was removed.
export function removeRetiredCorpusImport(root) {
  const path = join(root, CLAUDE_MD);
  if (!existsSync(path)) return false;
  const text = readFileSync(path, 'utf8');
  if (!CORPUS_IMPORT_RE.test(text)) return false;
  writeFileSync(path, text.replace(CORPUS_IMPORT_RE, ''));
  return true;
}

// The CLAUDE.md channel (#807): the generated rules index, plus the one line in the
// repo's own CLAUDE.md that imports it. Converged here rather than left to a session
// because the index is a function of the DECLARATION — so the two flows that already
// change a declaration (the nightly engine refresh and any pack change) are exactly
// the moments it can go stale, and both call convergeWiring.
//
// NOT the retired `@.claudinite/shared/CLAUDE.md` this file still strips above. That
// import reached INTO the mount, which is one-directional and slated to become a
// submodule; this one names a consumer-owned file sitting BESIDE it, derived from the
// consumer's own declaration. The two coexist deliberately: a member converging today
// loses the old shape and gains the new one in the same pass.
//
// The import goes after the first `# ` heading when the repo has one — a repo's title
// stays its first line — and at the very top otherwise. A repo with no CLAUDE.md at all gets one: without it the
// index is a file nothing loads.
const RULES_INDEX_IMPORT_RE = new RegExp(`^\\s*${RULES_INDEX_IMPORT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm');

export function ensureRulesIndexImport(root) {
  const path = join(root, CLAUDE_MD);
  if (!existsSync(path)) {
    writeFileSync(path, `${RULES_INDEX_IMPORT}\n`);
    return true;
  }
  const text = readFileSync(path, 'utf8');
  if (RULES_INDEX_IMPORT_RE.test(text)) return false;
  const lines = text.split('\n');
  const title = lines.findIndex((l) => l.startsWith('# '));
  const at = title === -1 ? 0 : title + 1;
  lines.splice(at, 0, ...(at === 0 ? [RULES_INDEX_IMPORT, ''] : ['', RULES_INDEX_IMPORT]));
  writeFileSync(path, lines.join('\n'));
  return true;
}

// --- the mount's own git attributes -----------------------------------------

// Everything Claudinite asks git to know about is a file INSIDE the mount root, so
// the attributes file lives there and a member's root `.gitattributes` stays the
// repo's own: git reads a `.gitattributes` in any directory, and its patterns are
// relative to that directory. Claudinite-owned, so it is converged to exact content
// rather than appended to.
export const MOUNT_ATTRIBUTES_FILE = `${MOUNT_ROOT}/.gitattributes`;

// `*GENERATED*` covers every generated file the mount carries — the rules and skills
// indexes, the usage fold — under the canon's GENERATED-file discipline and the
// `generated-merge-driver` check that enforces it, so a conflicting merge auto-resolves
// and this file never grows a line per artifact.
//
// The shared subtree is canon-owned content the member never authored, so the git HOST
// is told so: Linguist keeps a member's language stats off the corpus (which outweighs
// a small member's own source by byte count) and collapses the mount in a converge
// diff. Presentation only — the CHECK-scope exclusion is a separate, structural rule
// in the file-set builder (engine/checks/helpers/repo-context.mjs), which drops the
// mount prefix before attributes are ever consulted, so that exclusion holds on a host
// and a checkout that honor no attributes at all.
const MOUNT_ATTRIBUTES_TEXT = [
  '# GENERATED by Claudinite (engine/converge-wiring.mjs) — the attributes of the',
  "# mount's own files. A repo's root .gitattributes is the repo's own.",
  '*GENERATED* merge=ours',
  `${SHARED_NAME}/** linguist-vendored`,
].join('\n') + '\n';

// Returns true when the file was written (absent, or drifted from the target).
export function ensureMountAttributes(root) {
  const path = join(root, MOUNT_ATTRIBUTES_FILE);
  if (existsSync(path) && readFileSync(path, 'utf8') === MOUNT_ATTRIBUTES_TEXT) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, MOUNT_ATTRIBUTES_TEXT);
  return true;
}

// The three names the wiring used to expose, one per line it appended to the member's
// root file. Kept, and pointed at the file that now carries all three, because a
// member spends a window holding a NEWER engine beside an OLDER pack: a vendored
// pack-update flow still imports the first of these by name, and a removed export is
// a link-time SyntaxError that faults the whole flow.
/** @deprecated call ensureMountAttributes — the three lines are one converged file. */
export const ensureRulesIndexMergeAttribute = ensureMountAttributes;
/** @deprecated call ensureMountAttributes. */
export const ensureSkillsIndexMergeAttribute = ensureMountAttributes;
/** @deprecated call ensureMountAttributes. */
export const ensureMountVendoredAttribute = ensureMountAttributes;

// What those three appended, plus the `merge=ours` line the tasks pack seeded for the
// usage fold — the whole set Claudinite ever planted in a member's ROOT file, taken
// back now that the mount has its own (#1748). Each is matched as a whole line, so a
// repo's own entry for one of these paths (spelled differently, or carrying other
// attributes) is left alone; a root file with nothing but these in it goes away,
// leaving a repo that never had one as it was.
const RETIRED_ROOT_ATTRIBUTES = [
  'claudinite-rules.GENERATED.md merge=ours',
  'claudinite-skills.GENERATED.md merge=ours',
  'usage.GENERATED.json merge=ours',
  `${SHARED_SUBDIR.split(sep).join('/')}/** linguist-vendored`,
];

export function removeRetiredRootAttributes(root) {
  const path = join(root, '.gitattributes');
  if (!existsSync(path)) return false;
  const text = readFileSync(path, 'utf8');
  const kept = text.split('\n').filter((line) => !RETIRED_ROOT_ATTRIBUTES.includes(line.trim()));
  const next = kept.join('\n');
  if (next === text) return false;
  if (next.trim() === '') rmSync(path);
  else writeFileSync(path, next);
  return true;
}

// --- the repo's own local pack, seeded once at adoption ----------------------

// Every repo has lessons that are its own and portable nowhere: they need a home the
// moment there is anything to write, and a session that has to invent one first
// usually doesn't — it writes the rule into `basics` or into a `CLAUDE.md` paragraph
// instead, which is how a project's rules end up somewhere the corpus cannot reach.
// So adoption seeds the home empty, named for the repo, declared and imported like any
// other pack.
//
// BOOTSTRAP ONLY: this is a one-time seed of a file the repo then OWNS. A nightly that re-created it would resurrect a
// pack the owner deliberately deleted, and a nightly that rewrote it would overwrite
// the rules it exists to hold.

// A repo name as a pack id: kebab-case, the canon's naming rule for a pack directory
// (lowercase words joined by single hyphens), since the id is what the declaration,
// the mount path and every cross-reference then spell.
export const packIdForRepo = (fullName) => (fullName ?? '').split('/').pop()
  .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
  .replace(/[^a-zA-Z0-9]+/g, '-')
  .toLowerCase()
  .replace(/^-+|-+$/g, '');

const SEED_MANIFEST = (id) => `// ${id} — this repo's own pack: everything local, and portable nowhere. Its rules,
// and the checks, skills and tasks that carry them, all live here.
// Seeded empty at adoption; everything in it is this repo's to write. A lesson that
// would hold in another repo belongs in a canon pack instead — propose it upstream.
//
// The id is this directory's name and the prose is the RULES.md beside this file —
// both by convention (engine/pack_loader/pack-conventions.mjs), so neither is
// declared here.
export default {
  version: 1,
  ruleRoutingGuidance: {
    belongs: 'everything specific to this repository and portable nowhere else: its working rules, and the checks, skills and tasks carrying them',
    excludes: 'anything true beyond this repo — that belongs in a canon pack, proposed upstream',
  },
  detect: null,
  marker: null,
  worldRules: [],
};
`;

const SEED_PROSE = (id) => `# ${id} — this repo's own pack

The home for everything **specific to this repository**: the rules below, and beside them the
checks, skills and tasks that carry them. Nothing local needs a home invented for it — this is
that home. This file is loaded into every session through the rules index, so what lands *here*
should be a directive an agent can act on, not a description of how something works; a rule a
deterministic check can enforce belongs in this pack's \`declared-checks.json\` instead, and a
procedure with a nameable trigger in its own \`skills/<name>/SKILL.md\`.

A lesson that would hold in another repo does not belong here — propose it to the Claudinite
canon instead, where every repo gets it.

<!-- Nothing yet. The growth lifecycle writes here; so may you. -->
`;

// Seed `.claudinite/local/packs/<repo>/` and declare it. Returns the pack id when it
// created one, null when the repo already has that pack or already declares any local
// pack — a repo that has grown its own home must never get a second, empty one.
export function seedRepoLocalPack(root, fullName) {
  const id = packIdForRepo(fullName);
  if (!id) return null;
  const dir = join(root, LOCAL_PACKS_SUBDIR, id);
  if (existsSync(dir)) return null;

  const settingsFile = settingsPath(root);
  let raw;
  try { raw = JSON.parse(readFileSync(settingsFile, 'utf8')); } catch { return null; }
  const declared = Array.isArray(raw.packs) ? raw.packs : [];
  // Any local declaration at all means this repo already has a home of its own.
  if (declared.some((p) => String(typeof p === 'string' ? p : p?.id).startsWith('local'))) return null;

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'pack.mjs'), SEED_MANIFEST(id));
  writeFileSync(join(dir, 'RULES.md'), SEED_PROSE(id));

  // Declared as text, never a JSON round-trip: re-serializing rewrites what it was not
  // asked to — `ensure_ascii` escapes every non-ASCII character in a settings file full
  // of prose, and indent and key order become the serializer's opinion.
  const text = readFileSync(settingsFile, 'utf8');
  const entry = `"${LOCAL_DECL_PREFIX}${id}"`;
  const patched = text.replace(/("packs"\s*:\s*\[)/, (m) => `${m}\n    ${entry},`);
  writeFileSync(settingsFile, patched === text
    ? text // no `packs` array to extend — leave the file alone rather than guess at its shape
    : patched);
  return id;
}

// Strip the retired `badges` setting from the settings file — it configured a README
// row nothing writes any more (#1750). `badges` is
// not in CONFIG_KEYS, so a member still carrying it gets an unknown-setting error
// until the key goes; doing it here — beside the retired corpus import, for the
// same reason — means the converge that already runs on every member clears it,
// and nobody hand-edits a settings file to satisfy a check.
// Returns true when the key was removed. A malformed settings file is left alone.
//
// Cut out as TEXT, re-serializing only as a fallback: a JSON round-trip rewrites
// the whole file — re-escaping every non-ASCII character in the prose a settings
// file is full of — so a three-line deletion arrives as a diff touching every
// `reason` in the repo.
export function removeRetiredBadgeSetting(root) {
  const path = settingsPath(root);
  if (!existsSync(path)) return false;
  const text = readFileSync(path, 'utf8');
  let raw;
  try { raw = JSON.parse(text); } catch { return false; }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || raw.badges === undefined) return false;
  // The key as a materialized settings file carries it: two-space indent, either
  // followed by a comma (mid-object) or preceded by one (last key).
  const surgical = text.replace(/(,)?\n[ \t]*"badges"[ \t]*:[ \t]*\{[^{}]*\}(,)?(?=\n)/, (m, before, after) => (before && after ? ',' : ''));
  const next = surgical !== text && parses(surgical, raw) ? surgical
    : JSON.stringify(rest(raw), null, 2) + '\n';
  writeFileSync(path, next);
  return true;
}

const rest = ({ badges, ...keep }) => keep;
// The surgical cut is only taken when it produces the settings the round-trip would
// have — never trust a regex against JSON without re-reading what it made.
const parses = (text, raw) => {
  try { return JSON.stringify(JSON.parse(text)) === JSON.stringify(rest(raw)); }
  catch { return false; }
};

// Converge every wiring surface, returning a flat summary of what changed (empty
// when the repo was already converged). `stubText` is the vendored scheduler stub.
//
// `workflows: false` converges everything EXCEPT `.github/workflows/`. The engine
// update flow passes it: the scheduler workflow's content is a function of the
// task set, so pack changes are what rewrite it, and only the pack flow carries a
// credential that can land a workflow file at all (DESIGN §2.4, §3.7). A flow that
// wrote one it cannot deliver would fail its whole push, not just that file.
// `seedLocalPack` defaults off: it is a one-time seed of a file the repo then owns,
// and only bootstrap passes it — a nightly that re-created it would resurrect a pack
// the owner deliberately deleted.
export async function convergeWiring(root, fullName, { seedLocalPack = false } = {}) {
  const changed = [];
  const hooks = ensureHooks(root);
  for (const h of hooks.added) changed.push(`hook:${h}`);
  if (removeRetiredCorpusImport(root)) changed.push(`removed retired ${CLAUDE_MD} corpus import`);
  if (removeRetiredBadgeSetting(root)) changed.push('removed retired badges setting');
  // Adoption only, and BEFORE the index: seeding declares a pack, and the index is a
  // function of the declaration, so seeding after it would leave the repo's own pack
  // unimported until some later converge.
  if (seedLocalPack) {
    const seeded = seedRepoLocalPack(root, fullName);
    if (seeded) changed.push(`seeded ${LOCAL_PACKS_SUBDIR}/${seeded}`);
  }
  // The CLAUDE.md channel, in dependency order: the index, then the import that
  // loads it, then the merge attribute that keeps it from being hand-resolved.
  if (await writeRulesIndex(root)) changed.push(RULES_INDEX_FILE);
  if (await writeSkillsIndex(root)) changed.push(SKILLS_INDEX_FILE);
  if (ensureRulesIndexImport(root)) changed.push(`${CLAUDE_MD} rules-index import`);
  if (ensureMountAttributes(root)) changed.push(MOUNT_ATTRIBUTES_FILE);
  if (removeRetiredRootAttributes(root)) changed.push('removed retired root .gitattributes entries');
  return { changed, ...(hooks.error ? { error: hooks.error } : {}) };
}

// CLI: `node converge-wiring.mjs [owner/repo] [--seed-local-pack]` —
// converge THIS repo's distribution wiring. The full name comes from argv or
// GITHUB_REPOSITORY/CLAUDINITE_REPO. This is the single surface bootstrap (Part 5) and
// the update flows both invoke, so the wiring set is defined once, here — and the flag
// is the whole difference between them: seeding the repo's own local pack is a ONE-TIME
// seed of a file the repo then owns, which is exactly why the nightly must not pass it
// — it would resurrect a pack the owner deliberately deleted. The two workflow files are the tasks pack's to scaffold, and its
// own converge-workflows.mjs is the command that does it.
async function main() {
  const argv = process.argv.slice(2);
  const seedLocalPack = argv.includes('--seed-local-pack');
  const fullName = argv.find((a) => !a.startsWith('--')) || process.env.GITHUB_REPOSITORY || process.env.CLAUDINITE_REPO;
  if (!fullName) { console.error('converge-wiring: need owner/repo (argv or GITHUB_REPOSITORY)'); process.exit(1); }
  const root = process.env.CLAUDINITE_REPO_ROOT || process.cwd();
  const { changed, error } = await convergeWiring(root, fullName, { seedLocalPack });
  if (error) console.log(`! ${error}`);
  console.log(changed.length ? `converge-wiring: ${changed.join(', ')}` : 'converge-wiring: already converged');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
