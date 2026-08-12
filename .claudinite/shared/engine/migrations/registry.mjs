import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MIGRATION_FILE, migrationDirs, migrationActive, recordName } from '../checks/helpers/active-migrations.mjs';
import { MODEL_FAMILIES } from '../scheduler/model-map.mjs';

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
    out.push({ dir: d, ...spec });
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
// The capable caller announces itself with this variable. The baselining worker sets it
// when it can WITHHOLD those paths from its commit and hand them to the agent stage;
// anything else — an older vendored worker, a hand-run `node migrations/apply.mjs`, CI —
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
export async function applyRewrites(migration, { read, write }) {
  if (!migration.rewrite?.length) return [];
  if (migration.appliesTo && !(await migration.appliesTo(read))) return [];
  const done = [];
  for (const { file, replace } of migration.rewrite) {
    const text = await read(file);
    if (text == null) continue;
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
export const DECLARATION = '.claudinite-checks.json';

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
  const raw = await read(DECLARATION);
  if (raw == null) return [];                       // not a member — nothing to declare into
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
      done.push(`${DECLARATION}: declared ${id}`);
      continue;
    }
    // Declared already: the only thing still owed is a config it never got.
    if (!packConfig) continue;
    const prior = typeof packs[at] === 'string' ? { id } : packs[at];
    if (prior.config) continue;                     // the repo's own parameters — untouched
    packs[at] = { ...prior, id, config: packConfig };
    done.push(`${DECLARATION}: configured ${id}`);
  }
  if (done.length) await write(DECLARATION, `${JSON.stringify({ ...config, packs }, null, 2)}\n`);
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
  const raw = await read(DECLARATION);
  if (raw == null) return [];
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
    done.push(`${DECLARATION}: ${id} -> ${token}`);
  }
  if (done.length) await write(DECLARATION, `${JSON.stringify({ ...config, packs }, null, 2)}\n`);
  return done;
}

// The declaration tokens this op normalizes to and from. Stated here rather than
// imported from the pack registry: this module is the write side a consumer runs
// out of its own mount, and the two prefixes are the whole of what it needs.
const LOCAL_DECL = 'local/';
const LEGACY_LOCAL_DECL = 'local_packs/';

// EVERY write op a record can carry, in the order a run applies them, over one
// injected io. Both callers — the standalone applier and the engine update flow —
// go through this, so an op added to the vocabulary cannot reach one and miss the
// other: that omission is silent (the record simply does nothing on that path) and
// is exactly what a member would never notice.
export async function applyMigration(migration, io) {
  const applied = [];
  applied.push(...(await applyFileAliases(migration, io)));
  applied.push(...(await applyMaterializations(migration, io)));
  applied.push(...(await applyRewrites(migration, io)));
  applied.push(...(await applyPackDeclarations(migration, io)));
  applied.push(...(await applyLocalDeclarationNormalization(migration, io)));
  return applied;
}

// A migration record MAY carry a machine-readable AGENTIC note (task-prework
// DESIGN §7, the primitive absorbed from #405): member-side adaptation that no
// script can do — adapting consumer-authored `local/packs/` content to a changed
// engine contract. Shape: `agentic: { model, instructions }`, model a non-`none`
// family. baselining's prework reads this to decide whether a pending note
// needs the agent STAGE (and must therefore hold the stamp) rather than converging
// in code. Returns the validated note, or null when the record carries none;
// throws on a malformed note so a typo fails loudly instead of silently skipping
// agentic work (the #405 correctness risk).
export function migrationAgentic(m) {
  const a = m.agentic;
  if (a === undefined || a === null) return null;
  // NO AGENTIC WORK ON AN ENGINE MIGRATION, EVER (DESIGN §5, owner decision 3). The
  // engine update flow has no agentic stage and no lane to add one, so a note on an
  // engine record is not work that gets done later — it is a record that stops the
  // flow for every repo whose gap contains it. Rejected here, at the registry, so it
  // cannot be written in the first place; a pack record is where such work belongs,
  // as its update's apply stage.
  //
  // Judged by WHERE THE RECORD LIVES (`dir`, corpus-relative), the same structural
  // classifier everything else in this scheme uses. A spec with no `dir` is a caller
  // testing the shape rather than a discovered record, and is left alone.
  if (typeof m.dir === 'string' && m.dir.startsWith('engine/')) {
    throw new Error(`migration ${m.id}: an ENGINE migration may not carry an "agentic" note — `
      + 'the engine flow cannot run one (DESIGN §5). Move the work to the owning pack\'s apply stage.');
  }
  if (typeof a !== 'object' || Array.isArray(a)) {
    throw new Error(`migration ${m.id}: "agentic" must be an object { model, instructions }`);
  }
  if (!MODEL_FAMILIES.includes(a.model) || a.model === 'none') {
    throw new Error(`migration ${m.id}: agentic.model must be a non-"none" model family (${MODEL_FAMILIES.filter((f) => f !== 'none').join(', ')})`);
  }
  if (typeof a.instructions !== 'string' || a.instructions.trim() === '') {
    throw new Error(`migration ${m.id}: agentic.instructions must be a non-empty string`);
  }
  return { model: a.model, instructions: a.instructions };
}

// The records that carry a valid agentic note — the pending set baselining must
// escalate to an agent rather than apply in code. Stamp-date filtering (which
// notes still apply) is the caller's; this is the agentic gate over that set.
export function agenticMigrations(migrations) {
  return migrations.filter((m) => migrationAgentic(m) !== null);
}

