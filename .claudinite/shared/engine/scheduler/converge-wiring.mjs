// Fresh-path wiring convergence (task-prework DESIGN §7, the primitive
// absorbed from #405). The deterministic half of the self-refresh that
// has nothing to do with the vendored mount's CONTENT: the repo-specific wiring a
// scheduled Claudinite consumer must carry, converged idempotently in code so the
// nightly refresh never needs a model to re-enact bootstrap's prose.
//
// One source of truth: bootstrap Part 5 (the settings hooks) + Part 6 (the
// scheduler workflow) describe this same set for a fresh adoption; this module is
// what both bootstrap and the update flows CALL, so the wiring can never drift between
// "how a repo is set up" and "how the nightly keeps it set up".
//
// Operates on a repo working tree at `root` with node:fs directly (like
// apply-vendor-set.mjs), returning a summary of what it changed — idempotent: a
// repo already converged produces an empty change list.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hashedCron } from './hash-minute.mjs';
import { writeRulesIndex, RULES_INDEX_FILE, RULES_INDEX_IMPORT } from '../pack_loader/generate-rules-index.mjs';
import { LOCAL_PACKS_SUBDIR, LOCAL_DECL_PREFIX } from '../pack_loader/pack-registry.mjs';

// The settings-hook registrations a scheduled repo carries (bootstrap Part 5).
// Ensured present without clobbering — a set-union keyed on the command string, so
// a repo's own extra hooks and any hand-added entries survive untouched.
export const REQUIRED_HOOKS = [
  { event: 'SessionStart', matcher: null, command: 'bash $CLAUDE_PROJECT_DIR/.claudinite/shared/engine/hooks/session-start-command.sh' },
  { event: 'Stop', matcher: null, command: 'node $CLAUDE_PROJECT_DIR/.claudinite/shared/engine/hooks/stop-command.mjs' },
  { event: 'PreToolUse', matcher: 'Bash', command: 'node $CLAUDE_PROJECT_DIR/.claudinite/shared/engine/hooks/pretooluse-command.mjs' },
  { event: 'SessionEnd', matcher: null, command: 'node $CLAUDE_PROJECT_DIR/.claudinite/shared/engine/hooks/session-end-command.mjs' },
];

export const SCHEDULER_WORKFLOW = '.github/workflows/claudinite-scheduler.yml';
// The queue's second workflow (tasks-dispatch DESIGN §14). The first one keeps the
// path above: `claudinite-scheduler.yml` holds the tick and its drain, so the repo
// still has exactly one cron at one well-known path.
export const EXECUTOR_WORKFLOW = '.github/workflows/claudinite-executor.yml';
export const SETTINGS_PATH = '.claude/settings.json';
export const CLAUDE_MD = 'CLAUDE.md';
export const README = 'README.md';

// The pack-badge row: the marks of the packs this repo declares, on a single
// line of its README. Adoption seeds it and the repo owns it from there — which
// is why the row is gated behind `{ badges: true }` (the CLI's `--badges`, passed
// by bootstrap alone) rather than converged like the surfaces around it. A
// README belongs to its repo: a nightly that re-derived this row would rewrite a
// member's README every time its declaration moved, so the nightly stays out and
// a stale row is the repo's to fix (re-run the converge with `--badges`).
//
// Delimited by HTML comments rather than located by position, so the row can be
// re-converged in place wherever the repo has moved it, and so anything the repo
// writes AFTER the closing marker on the same line (a tagline, a build badge) is
// its own and survives untouched — which is why the CLOSING marker stays inline,
// at the end of the badges' own line.
//
// The OPENING marker gets a line to itself, and that newline is load-bearing: a
// line that BEGINS with `<!--` opens a CommonMark HTML block, and every character
// through the line carrying `-->` is then emitted as raw HTML. Put the badges
// after the opening marker on one line and a README renders the literal text
// `![basics](…)` instead of the images (#587). Breaking the line ends the HTML
// block at the marker, so the badges start a paragraph and parse as markdown.
export const BADGE_ROW_START = '<!-- claudinite:packs -->';
export const BADGE_ROW_END = '<!-- /claudinite:packs -->';
const BADGE_ROW_RE = new RegExp(`${BADGE_ROW_START}[\\s\\S]*?${BADGE_ROW_END}`);

// The retired corpus-index import (#385): a line importing `.claudinite/shared/CLAUDE.md`.
// The whole line (and its trailing newline) is removed wherever it appears.
const CORPUS_IMPORT_RE = /^.*@\.claudinite\/shared\/CLAUDE\.md.*\n?/m;

// The project's settings, loaded through the one reader that validates them.
// Dynamic and in one place: the scheduler reaches the checks helpers exactly here,
// so the cross-tree import stays a single, reviewable edge.
const repoConfig = async (root) => (await import('../checks/helpers/repo-context.mjs')).loadConfig(root);

// The repo Actions secrets its scheduled tasks declare via `required_secrets`,
// deduped and sorted. Async because task discovery is; pure otherwise.
export async function declaredSecrets(root, config) {
  const { discoverTasks } = await import('./discover.mjs');
  const { tasks } = await discoverTasks(root, config);
  const names = tasks.flatMap((t) => t.decl?.required_secrets ?? []);
  // Endpoint tokens ride the same rail (tasks-dispatch DESIGN §12, §14.6): the
  // config maps an endpoint name to a URL and to the NAME of the Actions secret
  // holding its token, and the stamp puts that name in the executor's env exactly
  // as a `required_secrets` entry. The executor reads it only at the moment of the
  // invocation call; nothing else in a task's life ever sees it.
  const endpointTokens = Object.values(config?.taskScheduler?.endpoints ?? {})
    .map((e) => e?.tokenSecret).filter((n) => typeof n === 'string' && n);
  return [...new Set([...names, ...endpointTokens])].sort();
}

// Stamp the declared secrets into the scheduler workflow's engine step, beside
// GITHUB_TOKEN. This is the whole delivery mechanism: GitHub Actions requires each
// secret to be named statically in the workflow, and a task's `required_secrets` is
// exactly that list — so the wiring converge writes it, and a worker then reads
// `process.env.<NAME>` like any other environment variable. No bundle, no parsing,
// no engine-side selection. Regenerated from the stub each converge, so the list
// tracks the declarations rather than accumulating.
// A stub says WHERE with the `# claudinite:secrets` marker, and the tick stub needs
// that: it has two jobs carrying GITHUB_TOKEN and only the executing one may see a
// secret. The fallback under the GITHUB_TOKEN line covers a stub that declares no
// marker.
const SECRETS_MARKER = /^[ \t]*# claudinite:secrets\b.*$/m;
export function withDeclaredSecrets(stubText, names = []) {
  if (!names.length) return stubText;
  const lines = names.map((n) => `          ${n}: \${{ secrets.${n} }}`).join('\n');
  if (SECRETS_MARKER.test(stubText)) return stubText.replace(SECRETS_MARKER, (m) => `${m}\n${lines}`);
  return stubText.replace(/^(\s*GITHUB_TOKEN: \$\{\{ github\.token \}\})$/m, `$1\n${lines}`);
}

// Re-converge the scheduler workflow to the vendored stub, with the cron minute set
// to this repo's stable hashed value (never guessed — hash-minute.mjs, a pure
// function of the full name, so re-vendors and this convergence agree) and the
// declared `required_secrets` stamped into the engine step's env. `stubText` is the
// vendored stub's content (the caller reads it from the mount). Returns true when
// the file was written (absent, or drifted from the target).
// What this repo's scheduler workflow SHOULD contain — the stub with its secrets
// stamped and its cron resolved, as text, touching no disk.
//
// Split out from the converge below because the pack update flow needs the answer
// without the side effect: it cannot write this file (its caller pushes with the
// Action's GITHUB_TOKEN, which GitHub never lets near `.github/workflows/`), so it
// WITHHOLDS the content and hands it to a lane that can. A flow that had to write
// the file in order to learn what it should say could not do that.
export function schedulerWorkflowTarget(fullName, stubText, secretNames = []) {
  return withDeclaredSecrets(stubText, secretNames)
    .replace(/cron:\s*'[^']*'/, `cron: '${hashedCron(fullName)}'`);
}

export function convergeSchedulerWorkflow(root, fullName, stubText, secretNames = []) {
  return writeWorkflow(root, SCHEDULER_WORKFLOW, schedulerWorkflowTarget(fullName, stubText, secretNames));
}

// The queue's second workflow — the label-event executor. No cron of its own (the
// tick's drain is the poll), so nothing about it is hashed; it only needs its
// secrets stamped.
export function convergeExecutorWorkflow(root, stubText, secretNames = []) {
  return writeWorkflow(root, EXECUTOR_WORKFLOW, withDeclaredSecrets(stubText, secretNames));
}

function writeWorkflow(root, relPath, target) {
  const path = join(root, relPath);
  const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (current === target) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, target);
  return true;
}

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
    const present = list.some((group) =>
      (h.matcher == null || group.matcher === h.matcher)
      && (group.hooks ?? []).some((entry) => entry?.command === h.command));
    if (!present) {
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
// The import goes after the first `# ` heading when the repo has one (the badge row's
// placement rule, for the same reason — a repo's title stays its first line), and at
// the very top otherwise. A repo with no CLAUDE.md at all gets one: without it the
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

// A GENERATED file wants a `merge=ours` .gitattributes entry (the canon's
// GENERATED-file discipline and the `generated-merge-driver` check that enforces it),
// declared in the same converge that first writes the file — otherwise every member
// picks up an advisory finding on a file it did not author.
export const RULES_INDEX_MERGE_ATTR = 'claudinite-rules.GENERATED.md merge=ours';

export function ensureRulesIndexMergeAttribute(root) {
  const path = join(root, '.gitattributes');
  const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  if (text.split('\n').some((l) => l.trim() === RULES_INDEX_MERGE_ATTR)) return false;
  writeFileSync(path, (text && !text.endsWith('\n') ? `${text}\n` : text) + `${RULES_INDEX_MERGE_ATTR}\n`);
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
// BOOTSTRAP ONLY, and gated like the badge row for the same reason: this is a one-time
// seed of a file the repo then OWNS. A nightly that re-created it would resurrect a
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

const SEED_MANIFEST = (id) => `// ${id} — this repo's own rules: the ones that are true here and portable nowhere.
// Seeded empty at adoption; everything in it is this repo's to write. A lesson that
// would hold in another repo belongs in a canon pack instead — propose it upstream.
export default {
  id: '${id}',
  version: 1,
  ruleRoutingGuidance: {
    belongs: 'working rules and lessons specific to this repository and not portable to any other',
    excludes: 'anything true beyond this repo — that belongs in a canon pack, proposed upstream',
  },
  detect: null,
  marker: null,
  prose: 'RULES.md',
  worldRules: [],
};
`;

const SEED_PROSE = (id) => `# ${id} — this repo's own rules

The capture surface for lessons **specific to this repository**. Loaded into every session
through the rules index, so what lands here should be a directive an agent can act on, not a
description of how something works.

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

  const settingsPath = join(root, '.claudinite-checks.json');
  let raw;
  try { raw = JSON.parse(readFileSync(settingsPath, 'utf8')); } catch { return null; }
  const declared = Array.isArray(raw.packs) ? raw.packs : [];
  // Any local declaration at all means this repo already has a home of its own.
  if (declared.some((p) => String(typeof p === 'string' ? p : p?.id).startsWith('local'))) return null;

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'pack.mjs'), SEED_MANIFEST(id));
  writeFileSync(join(dir, 'RULES.md'), SEED_PROSE(id));

  // Declared as text, never a JSON round-trip: re-serializing rewrites what it was not
  // asked to — `ensure_ascii` escapes every non-ASCII character in a settings file full
  // of prose, and indent and key order become the serializer's opinion.
  const text = readFileSync(settingsPath, 'utf8');
  const entry = `"${LOCAL_DECL_PREFIX}${id}"`;
  const patched = text.replace(/("packs"\s*:\s*\[)/, (m) => `${m}\n    ${entry},`);
  writeFileSync(settingsPath, patched === text
    ? text // no `packs` array to extend — leave the file alone rather than guess at its shape
    : patched);
  return id;
}

// Strip the retired `badges` setting from `.claudinite-checks.json`. `badges` is
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
  const path = join(root, '.claudinite-checks.json');
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

// The row's entries: each declared pack (the `requires` closure included, in
// declaration order) that has a badge on disk, as { id, path } with the path
// relative to the repo root. Derived from the pack's own `dir`, so it resolves to
// `packs/<id>/…` in the canon home and `.claudinite/shared/packs/<id>/…` in a
// consumer with no branch on which repo this is. A pack whose badge is missing is
// skipped rather than reported: a repo's own local pack need not have one.
export async function badgeRowEntries(root, config) {
  const { loadPacks, resolveDeclaredPacks, packEntryId } = await import('../pack_loader/pack-registry.mjs');
  const packs = await loadPacks({ localRoot: root });
  const byId = new Map(packs.map((p) => [p.id, p]));
  const entries = [];
  for (const entry of resolveDeclaredPacks(config.packs ?? [], packs)) {
    const pack = byId.get(packEntryId(entry));
    if (!pack || typeof pack.badge !== 'string' || !pack.badge) continue;
    const path = relative(root, join(pack.dir, pack.badge)).split('\\').join('/');
    if (existsSync(join(root, path))) entries.push({ id: pack.id, path });
  }
  return entries;
}

export const renderBadgeRow = (entries) =>
  `${BADGE_ROW_START}\n${entries.map((e) => `![${e.id}](${e.path} "${e.id}")`).join(' ')}${BADGE_ROW_END}`;

// Write the row into the repo's README: replacing the delimited block where one
// exists, otherwise introducing it just under the title (a README's badges belong
// where a reader looks first) or at the very top when there is no heading.
// Returns true when the file was written. No README, or nothing to show, means
// nothing to do — this converge never creates a README.
export function convergeBadgeRow(root, entries) {
  const path = join(root, README);
  if (!existsSync(path) || !entries.length) return false;
  const text = readFileSync(path, 'utf8');
  const row = renderBadgeRow(entries);
  if (BADGE_ROW_RE.test(text)) {
    const next = text.replace(BADGE_ROW_RE, row);
    if (next === text) return false;
    writeFileSync(path, next);
    return true;
  }
  const lines = text.split('\n');
  const title = lines.findIndex((l) => l.startsWith('# '));
  const at = title === -1 ? 0 : title + 1;
  lines.splice(at, 0, ...(at === 0 ? [row, ''] : ['', row]));
  writeFileSync(path, lines.join('\n'));
  return true;
}

// Converge every wiring surface, returning a flat summary of what changed (empty
// when the repo was already converged). `stubText` is the vendored scheduler stub.
//
// `badges` defaults off, and that default is the point: the nightly takes this
// call as it stands and only bootstrap opts the README row in.
// `workflows: false` converges everything EXCEPT `.github/workflows/`. The engine
// update flow passes it: the scheduler workflow's content is a function of the
// task set, so pack changes are what rewrite it, and only the pack flow carries a
// credential that can land a workflow file at all (DESIGN §2.4, §3.7). A flow that
// wrote one it cannot deliver would fail its whole push, not just that file.
// `seedLocalPack` defaults off for the same reason `badges` does: both are one-time
// seeds of files the repo then owns, and only bootstrap passes them.
export async function convergeWiring(root, fullName, stubText, secretNames = [], { badges = false, workflows = true, seedLocalPack = false, executorStub = null } = {}) {
  const changed = [];
  if (workflows && convergeSchedulerWorkflow(root, fullName, stubText, secretNames)) changed.push(SCHEDULER_WORKFLOW);
  // In queue mode `stubText` IS the tick stub (the CLI picks it by dispatch mode),
  // and the executor is its second workflow. Nothing removes the executor when a
  // repo flips back: rolling back is a config edit, and an executor workflow whose
  // repo runs no queue simply never sees a `task:ready` label event.
  if (workflows && executorStub && convergeExecutorWorkflow(root, executorStub, secretNames)) changed.push(EXECUTOR_WORKFLOW);
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
  if (ensureRulesIndexImport(root)) changed.push(`${CLAUDE_MD} rules-index import`);
  if (ensureRulesIndexMergeAttribute(root)) changed.push('.gitattributes merge=ours for the rules index');
  if (badges && convergeBadgeRow(root, await badgeRowEntries(root, await repoConfig(root)))) changed.push(`${README} pack row`);
  return { changed, ...(hooks.error ? { error: hooks.error } : {}) };
}

// CLI: `node converge-wiring.mjs [owner/repo] [--badges] [--seed-local-pack]` —
// converge THIS repo's wiring. The full name comes from argv or
// GITHUB_REPOSITORY/CLAUDINITE_REPO; the scheduler stub from the vendored mount. This
// is the single surface bootstrap (Part 6) and the update flows both invoke, so the
// wiring set is defined once, here — and the two flags are the whole difference
// between them. Both are ONE-TIME SEEDS of files the repo then owns (the README badge
// row, the repo's own local pack), which is exactly why the nightly must not pass
// them: it would rewrite a row the owner moved, or resurrect a pack they deleted.
async function main() {
  const argv = process.argv.slice(2);
  const badges = argv.includes('--badges');
  const seedLocalPack = argv.includes('--seed-local-pack');
  const fullName = argv.find((a) => !a.startsWith('--')) || process.env.GITHUB_REPOSITORY || process.env.CLAUDINITE_REPO;
  if (!fullName) { console.error('converge-wiring: need owner/repo (argv or GITHUB_REPOSITORY)'); process.exit(1); }
  const root = process.env.CLAUDINITE_REPO_ROOT || process.cwd();
  const config = await repoConfig(root);
  // The repo's one cron workflow is the queue's tick and its drain, at the path the
  // slot scheduler used to hold — so the one-cron rule and every reader that knows
  // this workflow by name keep holding across the retirement.
  const stubs = join(root, '.claudinite/shared/engine/scheduler/stubs');
  const stubPath = join(stubs, 'claudinite-tick.yml');
  if (!existsSync(stubPath)) { console.error(`converge-wiring: vendored stub not found at ${stubPath}`); process.exit(1); }
  const executorStub = existsSync(join(stubs, 'claudinite-executor.yml'))
    ? readFileSync(join(stubs, 'claudinite-executor.yml'), 'utf8') : null;
  const secretNames = await declaredSecrets(root, config);
  const { changed, error } = await convergeWiring(root, fullName, readFileSync(stubPath, 'utf8'), secretNames, { badges, seedLocalPack, executorStub });
  if (error) console.log(`! ${error}`);
  console.log(changed.length ? `converge-wiring: ${changed.join(', ')}` : 'converge-wiring: already converged');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
