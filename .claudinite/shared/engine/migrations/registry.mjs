import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MIGRATION_FILE, migrationDirs, migrationActive, recordName, flowOf } from '../checks/helpers/active-migrations.mjs';
import { RENAMED_PACKS } from '../pack_loader/renamed-packs.mjs';
import { SETTINGS_FILE, SETTINGS_FILES, LEGACY_SETTINGS_FILE } from '../settings-file.mjs';
import { installedVersions, withInstalledVersions, LEGACY_STAMP_KEY } from '../installed-versions.mjs';
import { ENDPOINTS_KEY, LEGACY_ENDPOINTS_KEY } from '../checks/helpers/repo-context.mjs';
import { LOCAL_PACK_ROOT, taskDirsWithModule, convertTaskDeclarations } from './task-declarations-to-json.mjs';

// <corpus>/engine/migrations/ — records are addressed corpus-relative, because they
// no longer share one directory with this module: an engine record sits beside it,
// a pack's under that pack.
const corpusRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

// Each migration lives in its own folder under the flow that owns it — an engine
// record beside this registry, a pack's under that pack — so a record can carry
// assets of its own and each flow can ship exactly its own set. The discovery
// surface — the roots, the folder listing, the recency predicate, and
// `migrationActive` — lives in the vendored engine lib
// (engine/checks/helpers/active-migrations.mjs) because pack CHECKS consult it and packs import
// only the engine surface (pack-independence); this registry re-exports it so
// canon-side callers keep one import home.
export { MIGRATION_FILE, migrationActive, recordName };

// Structural discovery, like packs/ and skills/: every
// <flow>/migrations/<landed-date>-<slug>/migration.mjs is a spec. ALL records
// present load — the apply/backfill path is unconditional, and FETCHING decides
// relevance: a vendored consumer mount carries only the recent records
// (vendoring's recency window), while a dormant project baselining out of a
// fresh canon clone sees every record ever landed and applies what it needs.
// Each object carries its `dir` — the record's CORPUS-RELATIVE path, which both
// names the record and says which flow owns it.
export async function loadMigrations() {
  const out = [];
  for (const d of migrationDirs()) {
    const spec = (await import(pathToFileURL(join(corpusRoot, d, MIGRATION_FILE)).href)).default;
    const record = { dir: d, ...spec };
    // Validated at LOAD, so a retired field cannot reach a flow that would ignore it,
    // and a malformed apply-stage declaration cannot reach the flow that acts on it.
    assertNoAgenticNote(record);
    assertApplyStageDeclaration(record);
    out.push(record);
  }
  return out;
}

// Read side — "prefer Y, fall back to X": the ordered list of acceptable paths
// for a canonical target (canonical first, then its legacy aliases). A tolerance
// point consults this instead of hardcoding its own LEGACY_* constant, so a
// rename is declared once here and every reader picks it up. Unknown targets
// resolve to just themselves.
export function resolvePath(migrations, canonical) {
  for (const m of migrations) {
    for (const a of m.aliases ?? []) {
      if (a.canonical === canonical) return [a.canonical, ...(a.legacy ?? [])];
    }
  }
  return [canonical];
}

// Write side — "and rename X -> Y": for each alias whose legacy path still
// exists and whose canonical does not, move legacy -> canonical. `exists` and
// `move` are injected so the same logic drives a local checkout (sync fs) or a
// future API applier (async). Idempotent — a no-op once the rename is done.
export async function applyFileAliases(migration, { exists, move }) {
  const moved = [];
  for (const a of migration.aliases ?? []) {
    for (const legacy of a.legacy ?? []) {
      if ((await exists(legacy)) && !(await exists(a.canonical))) {
        await move(legacy, a.canonical);
        moved.push(`${legacy} -> ${a.canonical}`);
      }
    }
  }
  return moved;
}

// Write side — "vendor these pack templates into the repo": for each declared
// materialization {template, dest}, copy the canon template to its destination
// when the dest is missing or has drifted from the template (idempotent; a
// hand-edited copy self-heals on the next pass). `readTemplate` reads from the
// canon (the pack tree / mounted .claudinite), `read`/`write` act on the consumer
// repo — the source and destination roots differ in a consumer, so they are
// distinct injected readers. Gated by the migration's `appliesTo` so it only
// touches repos that ship the pipeline (never the canon repo itself).
// A materialization whose dest is a WORKFLOW FILE can only be written by a caller that
// can get it delivered. The nightly converge pushes with the Action's GITHUB_TOKEN, which
// GitHub never lets write under `.github/workflows/`, and the refusal rejects the whole
// ref — so writing one into a tree that is about to be pushed by such a caller does not
// deliver a workflow, it fails the entire converge and everything else riding it.
//
// The capable caller announces itself with this variable. The pack update flow sets it
// when it can WITHHOLD those paths from its commit and hand them to the apply stage;
// anything else — an older vendored worker, a hand-run `node engine/migrations/apply.mjs`, CI —
// leaves it unset and the workflow materialization is skipped with a note.
//
// An ENV HANDSHAKE rather than a probe of the repo on disk, because what matters is what
// the RUNNING process can do and the disk cannot answer that: the vendor step earlier in
// the same cycle replaces the on-disk worker with the new one while the old code is still
// executing.
export const WITHHOLD_CAPABLE_ENV = 'CLAUDINITE_CAN_WITHHOLD_WORKFLOWS';
const WORKFLOW_DEST = '.github/workflows/';
export const callerCanDeliverWorkflows = (env = process.env) => env[WITHHOLD_CAPABLE_ENV] === '1';

export async function applyMaterializations(migration, { readTemplate, read, write, env = process.env }) {
  if (!migration.materialize?.length) return [];
  if (migration.appliesTo && !(await migration.appliesTo(read))) return [];
  const done = [];
  for (const { template, dest } of migration.materialize) {
    const content = await readTemplate(template);
    if (content == null) continue; // template missing (partial mount) — skip, never clobber with nothing
    if ((await read(dest)) === content) continue; // already vendored, unchanged
    if (dest.startsWith(WORKFLOW_DEST) && !callerCanDeliverWorkflows(env)) {
      // Reported rather than silent — a silent skip reads as "already current". A caller
      // that can withhold writes it on a later cycle.
      done.push(`SKIPPED ${dest} (workflow file; this caller cannot deliver one)`);
      continue;
    }
    await write(dest, content);
    done.push(`${dest} <- ${template}`);
  }
  return done;
}

// Write side — "rewrite these refs in place": for each declared file, apply its
// replacements (only those still matching), writing back when anything changed.
// Idempotent — a no-op once nothing matches. Preserves the rest of the file, so
// per-repo tweaks the template can't carry (e.g. an uncommented build_env block)
// survive. Same `appliesTo` gate.
//
// A replacement is either LITERAL (`{ from, to }`) or a PATTERN
// (`{ pattern: /…/g, to }`) — the regex-first shape engine migrations are meant to
// take (DESIGN §2.3), for the changes where no literal is common across repos.
// The pattern must be global, because every replacement here means replace-ALL:
// a non-global regex would silently rewrite only the first occurrence and leave a
// half-migrated file that reads as migrated.
export async function applyRewrites(migration, { read, write, env = process.env }) {
  if (!migration.rewrite?.length) return [];
  if (migration.appliesTo && !(await migration.appliesTo(read))) return [];
  const done = [];
  for (const { file, replace } of migration.rewrite) {
    const text = await read(file);
    if (text == null) continue;
    // The same gate `applyMaterializations` applies above, for the same reason and on
    // the same surface: a rewrite naming a path under `.github/workflows/` is a workflow
    // delivery too. It went unguarded until #1509 because no record rewrote one — and an
    // unguarded rewrite is worse than an unguarded materialization, because the caller's
    // `write` drops the path silently while `done` still names the file, so a run that
    // delivered nothing reported that it had.
    if (file.startsWith(WORKFLOW_DEST) && !callerCanDeliverWorkflows(env)) {
      done.push(`SKIPPED ${file} (workflow file; this caller cannot deliver one)`);
      continue;
    }
    let next = text;
    for (const r of replace ?? []) {
      if (r.pattern !== undefined) {
        if (!(r.pattern instanceof RegExp) || !r.pattern.global) {
          throw new Error(`migration ${migration.id}: rewrite pattern for ${file} must be a global RegExp — a non-global one rewrites only the first match`);
        }
        next = next.replace(r.pattern, r.to);
      } else {
        next = next.split(r.from).join(r.to);
      }
    }
    if (next !== text) { await write(file, next); done.push(file); }
  }
  return done;
}

// The declaration a pack-seeding op writes into. Fixed, not a parameter: this op
// declares PACKS, and a repo's declaration lives in exactly one file. A `file` knob
// would quietly make it a general JSON editor, which is a much larger thing to own.
//
// TWO NAMES WHILE THE RENAME DRAINS (#1252): a record runs on a member whose file may
// still be `.claudinite-checks.json`, and one that only knew the new name would write
// a SECOND declaration beside the real one — a settings file nothing reads, with the
// pack the record meant to seed in it. `declarationFile` asks the member which name
// it carries; every op below writes back to that same one.
export const DECLARATION = SETTINGS_FILE;

async function declarationFile(read) {
  for (const name of SETTINGS_FILES) {
    if ((await read(name)) != null) return name;
  }
  return null;
}

// Write side — "every member should now declare this pack": for each declared
// `{ id, config }`, add that pack to the member's `packs` when it is absent, and
// fill in a `config` the entry does not already carry. The op the other three could
// not express — `materialize` writes a whole template (it would clobber a per-repo
// declaration) and `rewrite` replaces literal text (declarations share no literal
// across repos) — and the shape a fleet-wide capability change actually has: a pack
// every member should run, whose parameters the canon knows and the member cannot
// derive.
//
// SEEDING, NEVER OVERRIDING. A pack the repo already declares keeps its entry, and a
// config it already carries is left exactly as it is: both are that repo's decisions,
// and a migration that reasserted them would fight the project every night. That
// makes the op idempotent by construction — a no-op once the entry is there.
//
// ORDER MATTERS AROUND IT. Declaring a pack whose code is not in the member's mount
// is a blocking `config` error there, so the caller must re-converge the mount after
// applying (baselining does; see its worker). This module only writes the file.
//
// It round-trips the file through JSON rather than editing settings as text, so the
// result is canonical 2-space settings with a trailing newline (what `--init` writes,
// and what every fleet declaration already is). Malformed JSON is left alone: the
// world runner reports it as the settings error it is, and a migration is not the
// place to guess at a repair. Same `appliesTo` gate as the other write ops.
export async function applyPackDeclarations(migration, { read, write }) {
  if (!migration.declarePacks?.length) return [];
  if (migration.appliesTo && !(await migration.appliesTo(read))) return [];
  const file = await declarationFile(read);
  if (file == null) return [];                      // not a member — nothing to declare into
  const raw = await read(file);
  let config;
  try { config = JSON.parse(raw); } catch { return []; }
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return [];
  const packs = Array.isArray(config.packs) ? [...config.packs] : [];
  const idOf = (e) => (typeof e === 'string' ? e : e?.id);
  const done = [];
  for (const { id, config: packConfig } of migration.declarePacks) {
    const at = packs.findIndex((e) => idOf(e) === id);
    if (at === -1) {
      packs.push(packConfig ? { id, config: packConfig } : id);
      done.push(`${file}: declared ${id}`);
      continue;
    }
    // Declared already: the only thing still owed is a config it never got.
    if (!packConfig) continue;
    const prior = typeof packs[at] === 'string' ? { id } : packs[at];
    if (prior.config) continue;                     // the repo's own parameters — untouched
    packs[at] = { ...prior, id, config: packConfig };
    done.push(`${file}: configured ${id}`);
  }
  if (done.length) await write(file, `${JSON.stringify({ ...config, packs }, null, 2)}\n`);
  return done;
}

// Write side — "normalize this repo's local-pack declarations": rewrite every
// declared local pack to the canonical `local/<id>` token, from the bare id or the
// earlier `local_packs/<id>` form.
//
// A NAMED CODEMOD rather than a `rewrite`, because the decision needs the repo's
// own disk. `local_packs/<id>` → `local/<id>` is a pure pattern, but a BARE id is
// only a local pack if that repo has one by that name — and a bare id that names a
// canon pack must not be touched. No regex can tell those apart, so the record
// declares `normalizeLocalDeclarations: true` and the deterministic code ships with
// the engine (DESIGN §2.3's "rarely code"). It is one op with one meaning, not a
// general escape hatch for arbitrary code in a record.
//
// SEEDS NOTHING AND DROPS NOTHING: entry objects keep their config, answers and
// order; only the id token changes. Idempotent — a repo already on `local/` is a
// no-op — and it patches the parsed declaration back through JSON.stringify with
// the same 2-space shape every other declaration writer here uses.
export async function applyLocalDeclarationNormalization(migration, { read, write, exists }) {
  if (!migration.normalizeLocalDeclarations) return [];
  if (migration.appliesTo && !(await migration.appliesTo(read))) return [];
  const file = await declarationFile(read);
  if (file == null) return [];
  const raw = await read(file);
  let config;
  try { config = JSON.parse(raw); } catch { return []; }
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return [];
  if (!Array.isArray(config.packs)) return [];

  const done = [];
  const packs = [];
  for (const entry of config.packs) {
    const id = typeof entry === 'string' ? entry : entry?.id;
    if (typeof id !== 'string' || id.startsWith(LOCAL_DECL)) { packs.push(entry); continue; }
    let bare = id.startsWith(LEGACY_LOCAL_DECL) ? id.slice(LEGACY_LOCAL_DECL.length) : null;
    if (bare === null) {
      // A bare id: local only if this repo actually carries that pack. Both mount
      // shapes are checked, because a repo mid-relocation may hold either.
      const isLocal = (await exists(`.claudinite/local/packs/${id}/pack.mjs`))
        || (await exists(`.claudinite/local_packs/${id}/pack.mjs`));
      if (!isLocal) { packs.push(entry); continue; }
      bare = id;
    }
    const token = `${LOCAL_DECL}${bare}`;
    packs.push(typeof entry === 'string' ? token : { ...entry, id: token });
    done.push(`${file}: ${id} -> ${token}`);
  }
  if (done.length) await write(file, `${JSON.stringify({ ...config, packs }, null, 2)}\n`);
  return done;
}

// The declaration tokens this op normalizes to and from. Stated here rather than
// imported from the pack registry: this module is the write side a consumer runs
// out of its own mount, and the two prefixes are the whole of what it needs.
const LOCAL_DECL = 'local/';
// @legacy-tolerance advisory:legacy-shape-in-use retire:#1640
const LEGACY_LOCAL_DECL = 'local_packs/';

// Write side — "the packs this repo declares have been renamed": rewrite each
// `packs` entry whose id is a legacy spelling to the id that pack carries today.
// The ids come from the engine's own rename map, never from the record, so a future
// rename needs no new op and no record restating what the loader already knows.
//
// STRUCTURAL, NOT TEXTUAL, and that is the whole point of it. The first attempt at
// this was a regex over the declaration, anchored on `"packs": [` so it could not
// wander into a member's own `{ "from": "core" }` barrier rule. It could not wander
// anywhere at all: a real packs array holds entry objects with nested arrays
// (`{ "id": "barriers", "via": ["basics"] }`), the anchor could not cross a nested
// `]`, and every element after the first such object was invisible to it. Parsing
// removes both failures at once — the `packs` array is the only thing read, so a
// same-named key anywhere else in the file is never even seen (#1041).
//
// SEEDS NOTHING AND DROPS NOTHING, like the local-declaration normalization beside
// it: entry objects keep their config, answers, `via` and order; only the id token
// changes. A LOCAL declaration is skipped — that namespace is the repo's, so a local
// pack sharing a canon pack's old name is not this op's business. Idempotent, so a
// repo already converged is a no-op, and it patches the parsed declaration back with
// the same 2-space shape every other declaration writer here uses.
// Two entries that were different packs and are now the same one. A rename can
// merge two ids into one (a pack absorbed into another), and every member carrying
// the absorbed pack carries the absorbing one too when the first `requires` the
// second — so the collision is not an edge case there, it is every member.
//
// Dropping either side would drop what a member wrote: `config` answers it gave at
// adoption, `rules` severities it chose, `accept` entries standing against findings
// that would otherwise come back. So the two are MERGED. The survivor is the entry
// that appeared first, and its own values win a key conflict — the absorbed entry
// fills only what the survivor does not say. Arrays (`accept`, `rules`, `via`)
// concatenate, dropping an element the survivor already carries verbatim. An object
// absorbed into a plain-string entry promotes the survivor to an object: a string
// entry carries an id and nothing else, so keeping the string would be the one shape
// that silently discards the other side.
export function mergeDeclarationEntries(survivor, absorbed) {
  if (typeof absorbed === 'string') return survivor;
  const base = typeof survivor === 'string' ? { id: survivor } : { ...survivor };
  for (const [key, value] of Object.entries(absorbed)) {
    if (key === 'id') continue;
    const have = base[key];
    if (have === undefined) { base[key] = value; continue; }
    if (Array.isArray(have) && Array.isArray(value)) {
      const seen = new Set(have.map((v) => JSON.stringify(v)));
      base[key] = [...have, ...value.filter((v) => !seen.has(JSON.stringify(v)))];
      continue;
    }
    if (have && value && typeof have === 'object' && typeof value === 'object'
      && !Array.isArray(have) && !Array.isArray(value)) {
      base[key] = { ...value, ...have };
    }
    // Two scalars that disagree: the survivor's stands. It is the entry the member
    // wrote for the pack that still exists under its own name.
  }
  return base;
}

export async function applyPackRenames(migration, { read, write }) {
  if (!migration.renameDeclaredPacks) return [];
  if (migration.appliesTo && !(await migration.appliesTo(read))) return [];
  const file = await declarationFile(read);
  if (file == null) return [];
  const raw = await read(file);
  let config;
  try { config = JSON.parse(raw); } catch { return []; }
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return [];
  if (!Array.isArray(config.packs)) return [];

  const done = [];
  const renamed = config.packs.map((entry) => {
    const id = typeof entry === 'string' ? entry : entry?.id;
    if (typeof id !== 'string' || id.startsWith(LOCAL_DECL) || id.startsWith(LEGACY_LOCAL_DECL)) return entry;
    const to = RENAMED_PACKS[id];
    if (to === undefined) return entry;
    done.push(`${file}: ${id} -> ${to}`);
    return typeof entry === 'string' ? to : { ...entry, id: to };
  });

  // Collapse what the rename made duplicates. Position is the first occurrence's,
  // so an id already in the array keeps its place rather than moving to where the
  // absorbed entry sat.
  const at = new Map();
  const packs = [];
  for (const entry of renamed) {
    const id = typeof entry === 'string' ? entry : entry?.id;
    if (typeof id !== 'string' || !at.has(id)) {
      if (typeof id === 'string') at.set(id, packs.length);
      packs.push(entry);
      continue;
    }
    const i = at.get(id);
    packs[i] = mergeDeclarationEntries(packs[i], entry);
    done.push(`${file}: merged a second "${id}" entry into the first`);
  }

  if (done.length) await write(file, `${JSON.stringify({ ...config, packs }, null, 2)}\n`);
  return done;
}


// Write side — "this member's settings file moves to its new name and its new
// shape" (#1252). The one op that RENAMES the declaration, which is why it is an op
// rather than four `rewrite`s: a rewrite replaces literal text, and no two members
// share a literal here; a materialization writes a whole template, which would
// clobber every project's own declaration.
//
// What it does, in the order that keeps a half-applied run readable:
//   1. moves `.claudinite-checks.json` to `.claudinite-settings.json` (git sees a
//      rename, so the file's history follows it);
//   2. lifts the retired `claudinite` block's `engineVersion` to the top level and
//      its `packVersions` onto the entry of each pack they price, dropping any key
//      no entry names — a version for a pack the declaration does not carry prices
//      nothing, and inventing an entry for it would activate a pack nobody declared;
//   3. turns `maintenance.delivery: review` into
//      `dailyClaudiniteUpdatesRequirePrReview: true` and drops the block — including
//      `mechanism`, whose only rival was deleted in #768 Phase 5, so it had exactly
//      one possible answer for every member that could still ask;
//   4. renames `taskScheduler.endpoints` to `agenticTaskInvocationEndpoints`.
//
// IDEMPOTENT BY CONSTRUCTION: every step is stated as "if the retired shape is
// there", so a second run finds nothing and writes nothing. It reads the member's
// OWN file and rewrites only the keys it names — a project's rules, accept entries,
// pack config and answers pass through untouched, and key ORDER is preserved for
// everything it does not move, because this is a file people read.
export async function applySettingsReshape(migration, { read, write, move, exists }) {
  if (!migration.reshapeSettings) return [];
  if (migration.appliesTo && !(await migration.appliesTo(read))) return [];
  const file = await declarationFile(read);
  if (file == null) return [];
  const raw = await read(file);
  let config;
  try { config = JSON.parse(raw); } catch { return []; }
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return [];

  const done = [];

  // 1. The name. Moved before anything is written, so the write below lands on the
  //    renamed file and git records one rename rather than a delete and an add.
  if (file === LEGACY_SETTINGS_FILE) {
    if (await exists(SETTINGS_FILE)) return [];     // both names present — a repair no record should guess at
    await move(LEGACY_SETTINGS_FILE, SETTINGS_FILE);
    done.push(`${LEGACY_SETTINGS_FILE} -> ${SETTINGS_FILE}`);
  }

  // 2. The versions, onto the shape that holds them now.
  let next = config;
  if (next[LEGACY_STAMP_KEY] !== undefined) {
    const { engineVersion, packVersions } = installedVersions(next);
    next = withInstalledVersions(next, { engineVersion, packVersions });
    delete next[LEGACY_STAMP_KEY];
    done.push(`${SETTINGS_FILE}: engineVersion and per-pack versions lifted out of "${LEGACY_STAMP_KEY}"`);
  }

  // 3. The delivery override. Only `review` carries an intent worth keeping; every
  //    other value said what the absent key now says.
  if (next.maintenance !== undefined) {
    const delivery = String(next.maintenance?.delivery ?? '').trim();
    const { maintenance, ...rest } = next;
    next = rest;
    if (delivery === 'review' || delivery === 'pr') {
      next.dailyClaudiniteUpdatesRequirePrReview = true;
      done.push(`${SETTINGS_FILE}: maintenance.delivery "${delivery}" -> dailyClaudiniteUpdatesRequirePrReview: true`);
    } else {
      done.push(`${SETTINGS_FILE}: dropped the retired "maintenance" block`);
    }
  }

  // 4. The endpoint map's name.
  const scheduler = next.taskScheduler;
  if (scheduler && typeof scheduler === 'object' && !Array.isArray(scheduler)
      && scheduler[LEGACY_ENDPOINTS_KEY] !== undefined && scheduler[ENDPOINTS_KEY] === undefined) {
    const { [LEGACY_ENDPOINTS_KEY]: endpoints, ...restScheduler } = scheduler;
    next = { ...next, taskScheduler: { [ENDPOINTS_KEY]: endpoints, ...restScheduler } };
    done.push(`${SETTINGS_FILE}: taskScheduler.${LEGACY_ENDPOINTS_KEY} -> ${ENDPOINTS_KEY}`);
  }

  if (done.length) await write(SETTINGS_FILE, `${JSON.stringify(next, null, 2)}\n`);
  return done;
}

// EVERY write op a record can carry, in the order a run applies them, over one
// injected io. Both callers — the standalone applier and the engine update flow —
// go through this, so an op added to the vocabulary cannot reach one and miss the
// other: that omission is silent (the record simply does nothing on that path) and
// is exactly what a member would never notice.
// Write side — "this repo's own task declarations are data": convert every local
// pack's `tasks/<name>/task.mjs` to `task.json` and delete the module, so a member
// never converts by hand. A NAMED CODEMOD like the declaration normalization
// above: the decision needs the repo's own disk (which folders carry a module),
// and the JSON is the module's evaluated export, which no rewrite can produce.
// The record declares `taskDeclarationsToJson: true`; the converter ships with the
// engine (task-declarations-to-json.mjs) and is the same one the CLI runs.
//
// Needs three capabilities beyond the classic io — a directory listing, a delete
// and a module import. A caller that lacks them (an older vendored worker running
// this registry) converts nothing rather than half-converting: the member keeps
// its modules, which still load, until a worker that can do the whole step runs.
export async function applyTaskDeclarationConversion(migration, io) {
  if (!migration.taskDeclarationsToJson) return [];
  if (['listDir', 'remove', 'importModule'].some((c) => typeof io[c] !== 'function')) return [];
  if (migration.appliesTo && !(await migration.appliesTo(io.read))) return [];
  return convertTaskDeclarations(taskDirsWithModule([LOCAL_PACK_ROOT], io), io);
}

export async function applyMigration(migration, io) {
  const applied = [];
  applied.push(...(await applyFileAliases(migration, io)));
  applied.push(...(await applyMaterializations(migration, io)));
  applied.push(...(await applyRewrites(migration, io)));
  applied.push(...(await applyPackDeclarations(migration, io)));
  applied.push(...(await applyLocalDeclarationNormalization(migration, io)));
  applied.push(...(await applyTaskDeclarationConversion(migration, io)));
  applied.push(...(await applyPackRenames(migration, io)));
  // LAST: every op above writes to whichever name the member still carries, and this
  // is the one that changes which name that is.
  applied.push(...(await applySettingsReshape(migration, io)));
  return applied;
}

// THE `agentic` FIELD IS RETIRED (#768 Phase 5), and its successor is `applyStage`
// below. A record used to carry `agentic: { model, instructions }` — member-side
// adaptation no script could do — and baselining's code-work read it to decide whether
// a pending note needed an agent stage, holding the member's stamp until one ran.
//
// What the successor drops is the MODEL knob. Which model runs a session is the
// scheduler's answer (packs/claudinite-tasks/model-map.mjs, off the task declaration), and
// a record reaching around it to name its own was a second authority over the same
// fact. What a record legitimately knows is narrower and is all `applyStage` asks
// for: whether its change needs a session at all, and what that session must do.
//
// The field is not merely ignored, it is REJECTED. An ignored field on a record
// someone writes in good faith is work that silently never happens; the whole reason
// the note existed was that skipping such work quietly is a correctness risk (#405).
// Failing at load turns a stale or hopeful note into an error with a fix attached.
export function assertNoAgenticNote(m) {
  if (m?.agentic === undefined || m?.agentic === null) return;
  throw new Error(`migration ${m.id}: the "agentic" field was retired in #768 Phase 5 and is no longer run. `
    + 'Declare `applyStage: { why, instructions }` instead — same intent, without the model knob, which the '
    + 'scheduler owns. Engine records may not carry it at all (DESIGN §5); a pack record may.');
}

// THE `applyStage` FIELD: this record's change needs a session on the member.
//
// It exists because the alternative was worse. The pack flow used to decide the
// apply stage from its VERSION PLAN — "any pack version moved" — which is a fact
// about the CANON, while the stage exists for a fact about the MEMBER: the pack's
// new rules met content the canon has never seen. Since a record can only reach an
// up-to-date member if its pack's manifest version bumps, and every bump fired the
// stage, a purely mechanical migration — a regex rewrite, a declaration seed — could
// not be shipped without spending an agent session on every member in the fleet
// (#798). The record's author knows which of the two kinds they wrote; a version
// number never can.
//
// SHAPE, VALIDATED AT LOAD for the same reason the retired field is rejected there:
// a record whose declaration is malformed must fail where it is written, not go
// quietly unread by the flow that would have acted on it.
//
//   - `why` (required, non-empty string) — what the session is for, in the PR and in
//     the log. The terminal vocabulary insists every non-green end be explainable
//     (updates/terminals.mjs), and this is the sentence for this one.
//   - `instructions` (optional string) — appended to the standing brief. The standing
//     brief is policy that holds for every apply stage; this is what only this record
//     knows, and without it the declaration would be a bare boolean that tells the
//     session nothing about the change that summoned it.
//
// ENGINE RECORDS MAY NOT CARRY IT. "No agentic work in the engine flow. Ever."
// (DESIGN §5) — and the flow is read off where the record LIVES, so this is checked
// against the same structural classifier and cannot be misdeclared.
export function assertApplyStageDeclaration(m) {
  const declared = m?.applyStage;
  if (declared === undefined || declared === null) return;
  const bad = (what) => { throw new Error(`migration ${m.id}: ${what}`); };
  if (m.dir && flowOf(m.dir).flow !== 'pack') {
    bad('only a PACK record may declare "applyStage" — the engine update flow has no agentic lane (DESIGN §5). '
      + 'If the change needs a session on each member, it belongs to the pack whose rules it changes.');
  }
  if (typeof declared !== 'object' || Array.isArray(declared)) {
    bad('"applyStage" must be an object `{ why, instructions }`, not a bare flag — a stage nobody can explain '
      + 'is one nobody will trust the next time it fires.');
  }
  if (typeof declared.why !== 'string' || declared.why.trim() === '') {
    bad('"applyStage.why" must be a non-empty string saying what the session is for; it is what the PR and the log report.');
  }
  if (declared.instructions !== undefined && typeof declared.instructions !== 'string') {
    bad('"applyStage.instructions" must be a string — it is appended verbatim to the apply-stage brief.');
  }
}

