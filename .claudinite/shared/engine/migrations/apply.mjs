#!/usr/bin/env node
// Perform every declared migration's write side in a checkout:
//   - file aliases  — "prefer Y, fall back to X, and rename X -> Y"
//   - materialize   — vendor pack templates into the repo's own tree
//   - rewrite       — repoint refs in place (idempotent literal replacements)
//   - declarePacks  — declare a pack (and its config) the member does not carry yet
//   - normalizeLocalDeclarations — rewrite local-pack declarations to `local/<id>`
//   - taskDeclarationsToJson — convert local-pack task.mjs declarations to task.json
// Idempotent: a no-op once everything has been applied. Dependency-free.
//
// Two roots. The DEST is the repo being healed (CLAUDE_PROJECT_DIR / cwd). The
// TEMPLATE source is the corpus that ships the migrations — the root this module
// sits two levels under (engine/migrations/): in the canon repo that's the repo
// root; in a consumer that mounts Claudinite at .claudinite/shared/, it's that
// mount root (so a template path like packs/…/stubs/foo.yml resolves against the
// mounted pack, while its dest lands in the consumer's own .github/). The two
// coincide in the canon repo.
//
// Runs against a local checkout (a session, CI, or a future SessionStart
// self-heal hook wired via bootstrap). Each member migrates ITSELF: the update flows
// runs this applier from the fresh canon clone it fetched, so even a dormant
// project catches up on every record ever landed — there is no fleet-wide
// apply pass and no retirement; the records simply accumulate.
import { existsSync, renameSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadMigrations, applyMigration } from './registry.mjs';

export async function main() {
  const repoRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const canonRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url)))); // <corpus>/engine/migrations/
  const migrations = await loadMigrations();

  const exists = (p) => existsSync(join(repoRoot, p));
  const read = (p) => (existsSync(join(repoRoot, p)) ? readFileSync(join(repoRoot, p), 'utf8') : null);
  const write = (p, c) => {
    mkdirSync(dirname(join(repoRoot, p)), { recursive: true });
    writeFileSync(join(repoRoot, p), c);
  };
  const move = (from, to) => {
    mkdirSync(dirname(join(repoRoot, to)), { recursive: true });
    renameSync(join(repoRoot, from), join(repoRoot, to));
  };
  const readTemplate = (p) => (existsSync(join(canonRoot, p)) ? readFileSync(join(canonRoot, p), 'utf8') : null);
  const listDir = (p) => { try { return readdirSync(join(repoRoot, p)); } catch { return null; } };
  const remove = (p) => rmSync(join(repoRoot, p), { force: true });
  const importModule = (p) => import(pathToFileURL(join(repoRoot, p)).href);

  const applied = [];
  for (const m of migrations) applied.push(...(await applyMigration(m, { exists, move, read, write, readTemplate, listDir, remove, importModule })));
  if (applied.length) console.log(`Applied migrations:\n${applied.map((x) => `  ${x}`).join('\n')}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((e) => { console.error(`migrations apply failed: ${e.message}`); process.exit(1); });
}
