#!/usr/bin/env node
// Perform every declared migration's write side in a checkout:
//   - file aliases  — "prefer Y, fall back to X, and rename X -> Y"
//   - materialize   — vendor pack templates into the repo's own tree
//   - rewrite       — repoint refs in place (idempotent literal replacements)
//   - declarePacks  — declare a pack (and its config) the member does not carry yet
// Idempotent: a no-op once everything has been applied. Dependency-free.
//
// Two roots. The DEST is the repo being healed (CLAUDE_PROJECT_DIR / cwd). The
// TEMPLATE source is the canon that ships the migrations — the parent of this
// migrations/ dir: in the canon repo that's the repo root; in a consumer that
// mounts Claudinite at .claudinite/, it's .claudinite/ (so a template path like
// packs/…/stubs/foo.yml resolves against the mounted pack, while its dest lands
// in the consumer's own .github/). The two coincide in the canon repo.
//
// Runs against a local checkout (a session, CI, or a future SessionStart
// self-heal hook wired via bootstrap). Each member migrates ITSELF: baselining
// runs this applier from the fresh canon clone it fetched, so even a dormant
// project catches up on every record ever landed — there is no fleet-wide
// apply pass and no retirement; the records simply accumulate.
import { existsSync, renameSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadMigrations, applyFileAliases, applyMaterializations, applyRewrites, applyPackDeclarations } from './registry.mjs';

async function main() {
  const repoRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const canonRoot = dirname(dirname(fileURLToPath(import.meta.url))); // parent of migrations/
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

  const applied = [];
  for (const m of migrations) {
    applied.push(...(await applyFileAliases(m, { exists, move })));
    applied.push(...(await applyMaterializations(m, { readTemplate, read, write })));
    applied.push(...(await applyRewrites(m, { read, write })));
    applied.push(...(await applyPackDeclarations(m, { read, write })));
  }
  if (applied.length) console.log(`Applied migrations:\n${applied.map((x) => `  ${x}`).join('\n')}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((e) => { console.error(`migrations apply failed: ${e.message}`); process.exit(1); });
}
