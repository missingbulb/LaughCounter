#!/usr/bin/env node
// The rules index: `.claudinite/claudinite-rules.GENERATED.md`, a file of nothing but
// `@` imports — one per active pack's RULES.md — which the repo's own CLAUDE.md
// imports in turn. That is the whole artifact; anything else a session needs is read
// on demand, not carried here.
//
// WHY IT EXISTS — #807. A SessionStart hook's contract is "stdout becomes session
// context", and that contract has no delivery receipt. Measured 2026-08-13: the
// orchestrator emitted 82,267 bytes, the harness delivered a ~2KB preview plus a path
// to a persisted file, and ~80KB of guidance never reached the model. Nothing on
// either side could tell. The pack corpus was 79,750 of those bytes.
//
// CLAUDE.md is the channel that does not have this failure: it is "loaded in full
// regardless of length" (the memory docs), delivered as a user message after the
// system prompt, and re-injected after `/compact`.
//
// THIS REVERSES #385, ON NEW EVIDENCE. A corpus-index `CLAUDE.md` with a consumer
// `@`-import existed and was retired by owner decision — vendoring/DESIGN.md recorded
// the replacement as "a session's rules arrive injected". #807 is the measurement that
// injection does not arrive. Two things differ from the retired shape:
//   - The index lives BESIDE the mount, not inside it. The mount is one-directional
//     and slated to become a git submodule, which cannot carry a consumer's files;
//     the index is the consumer's, derived from the consumer's declaration.
//   - It is GENERATED, so it cannot drift from the packs a repo actually declares the
//     way a hand-maintained index did.
//
// TWO HARNESS FACTS THE FORMAT IS BUILT AROUND (memory docs):
//   - Relative `@` paths resolve against the file CONTAINING the import, not the cwd.
//     So the index's own directory is the origin for every path here, which is why
//     they are computed with `relative()` off it rather than off the repo root.
//   - Import parsing skips code spans, so a path in backticks is never followed. The
//     lines here are deliberately bare.
// Import depth is four hops; this uses two (CLAUDE.md → index → a pack's RULES.md).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadPacks, isActive, SHARED_SUBDIR } from './pack-registry.mjs';

// The index, and the line a repo's CLAUDE.md carries to pull it in. One definition:
// the generator writes the first, the converge ensures the second, and the basics
// check that polices a member tests for both.
export const RULES_INDEX_FILE = join('.claudinite', 'claudinite-rules.GENERATED.md');
export const RULES_INDEX_IMPORT = '@.claudinite/claudinite-rules.GENERATED.md';

// `@` paths are POSIX in a memory file whatever the host separator is.
const posix = (p) => p.split(sep).join('/');

// The repo's declared pack list, read the way every other loader reads it. A missing
// or malformed settings file means nothing is declared.
function declaredPacks(projectRoot) {
  const configPath = join(projectRoot, '.claudinite-checks.json');
  if (!existsSync(configPath)) return [];
  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf8'));
    return Array.isArray(raw.packs) ? raw.packs : [];
  } catch { return []; }
}

// Where the corpus sits IN THE REPO BEING WRITTEN FOR: the vendored mount when the
// repo has one, the repo root in the canon (which mounts nothing and runs its live
// tree).
//
// This is not always the corpus the manifests were LOADED from, and the difference is
// why this exists. `engine-update.mjs` converges a member out of a canon clone — it
// vendors into `<member>/.claudinite/shared/`, then converges with the member as
// `root` while the pack registry, which resolves `packs/` off its own module location,
// is still reporting the clone's directories. Writing `pack.dir` into the index there
// would emit imports traversing out to a checkout that exists only on the runner. The
// manifests are content-identical across the two (same commit, that being what
// vendoring means), so ids are safe to re-root — and the `existsSync` below is against
// the TARGET, so a pack whose files are not vendored yet is skipped rather than
// imported as a dangling path.
export const corpusRootFor = (projectRoot) => (
  existsSync(join(projectRoot, SHARED_SUBDIR)) ? join(projectRoot, SHARED_SUBDIR) : projectRoot
);

// A pack's prose, as a path inside the repo being written for. A local pack was
// discovered under that repo already, so its own directory is right; a canon pack is
// re-rooted onto the target's corpus.
const prosePathIn = (pack, corpusRoot) => (
  pack.local ? join(pack.dir, pack.prose) : join(corpusRoot, 'packs', pack.id, pack.prose)
);

// The import lines for a resolved pack set, in the order the registry gives them.
// Split out from the disk-reading wrapper so the shape is testable against hand-built
// packs, and returned as a list rather than text so a test can compare the PACKS an
// index names against the packs a repo declares.
export function ruleImports(active, { indexDir, corpusRoot }) {
  const imports = [];
  for (const pack of active) {
    if (!pack.prose) continue;
    const prosePath = prosePathIn(pack, corpusRoot);
    if (!existsSync(prosePath)) continue;
    // Relative to the INDEX, because that is what the harness resolves against.
    imports.push({ id: pack.id, path: posix(relative(indexDir, prosePath)) });
  }
  return imports;
}

// The index as text: a generated-file banner and the imports, nothing else. The banner
// is an HTML comment on purpose — block comments are stripped before a memory file
// enters context, so it costs nothing every session while staying visible to anything
// that opens the file with Read.
export const renderRulesIndex = (imports) => (imports.length
  ? `<!-- GENERATED — do not hand-edit; every converge rewrites it. Edit a pack's RULES.md. -->\n${
    imports.map((i) => `@${i.path}`).join('\n')}\n`
  : null);

// The imports for a repo on disk: discover its packs (canon mount + its own local
// packs) and keep the active ones. Never throws — a caller in a converge treats an
// empty list as "nothing to write".
export async function rulesIndexImports(projectRoot) {
  try {
    const packs = await loadPacks({ localRoot: projectRoot });
    const active = packs.filter((pack) => isActive(pack, { packs: declaredPacks(projectRoot) }));
    return ruleImports(active, {
      indexDir: join(projectRoot, dirname(RULES_INDEX_FILE)),
      corpusRoot: corpusRootFor(projectRoot),
    });
  } catch {
    return []; // fail soft — a broken loader must never block a converge
  }
}

export const rulesIndexContent = async (projectRoot) => renderRulesIndex(await rulesIndexImports(projectRoot));

// Write the index if its content changed. Returns true when the file moved, so a
// converge can report it and a no-op converge stays a no-op. A repo with nothing to
// import leaves any existing file alone rather than truncating it — the packs may
// simply not be vendored yet, and blanking the index would take the rules off the
// channel with nothing to say so.
export async function writeRulesIndex(projectRoot) {
  const content = await rulesIndexContent(projectRoot);
  if (content === null) return false;
  const path = join(projectRoot, RULES_INDEX_FILE);
  if (existsSync(path) && readFileSync(path, 'utf8') === content) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return true;
}

// CLI: `node generate-rules-index.mjs [--write] [root]` — print the index, or write it.
async function main() {
  const argv = process.argv.slice(2);
  const root = argv.find((a) => !a.startsWith('--')) || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (argv.includes('--write')) {
    console.log(await writeRulesIndex(root) ? `wrote ${RULES_INDEX_FILE}` : `${RULES_INDEX_FILE} already current`);
    return;
  }
  const content = await rulesIndexContent(root);
  if (content !== null) process.stdout.write(content);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
