import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MIGRATION_FILE, migrationDirs, migrationActive } from '../engine/checks/helpers/active-migrations.mjs';
import { MODEL_FAMILIES } from '../engine/scheduler/model-map.mjs';

const dir = dirname(fileURLToPath(import.meta.url));

// Each migration lives in its own folder beside the mechanism (this registry,
// apply.mjs, the README), so a record can carry assets of its own and the set
// reads cleanly. The sync surface — the folder listing, the recency predicate,
// and `migrationActive` — lives in the vendored engine lib
// (engine/checks/helpers/active-migrations.mjs) because pack CHECKS consult it and packs import
// only the engine surface (pack-independence); this registry re-exports it so
// canon-side callers keep one import home.
export { MIGRATION_FILE, migrationActive };

// Structural discovery, like packs/ and skills/: every
// migrations/<landed-date>-<slug>/migration.mjs is a spec. ALL records present
// load — the apply/backfill path is unconditional, and FETCHING decides
// relevance: a vendored consumer mount carries only the recent records
// (vendoring's recency window), while a dormant project baselining out of a
// fresh canon clone sees every record ever landed and applies what it needs.
// Each object carries its `dir` folder name, so callers can name a record and
// build its repo-relative path (migrations/<dir>/migration.mjs).
export async function loadMigrations() {
  const out = [];
  for (const d of migrationDirs()) {
    const spec = (await import(pathToFileURL(join(dir, d, MIGRATION_FILE)).href)).default;
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
// literal from->to replacements (only those whose `from` is still present),
// writing back when anything changed. Idempotent — a no-op once every `from` is
// gone. Preserves the rest of the file, so per-repo tweaks the template can't
// carry (e.g. an uncommented build_env block) survive. Same `appliesTo` gate.
export async function applyRewrites(migration, { read, write }) {
  if (!migration.rewrite?.length) return [];
  if (migration.appliesTo && !(await migration.appliesTo(read))) return [];
  const done = [];
  for (const { file, replace } of migration.rewrite) {
    const text = await read(file);
    if (text == null) continue;
    let next = text;
    for (const { from, to } of replace ?? []) next = next.split(from).join(to);
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

