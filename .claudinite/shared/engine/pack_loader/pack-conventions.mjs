import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// WHAT A PACK'S DIRECTORY ALREADY SAYS, AND WHAT SILENCE MEANS. Most of the
// manifest's fields had, in every pack ever written, exactly one correct value —
// either the one the pack's own tree already gave, or the one that means "this
// pack does not do that". The id repeated the directory name; `badge` and `prose`
// named the two files beside the manifest; `skills`, `worldRules` and `workRules`
// listed subdirectory and module contents the loader can read for itself; and
// `detect: null, marker: null` said, in two lines per pack, that a pack carries no
// fingerprint. A field with exactly one correct value is not a declaration; it is
// a line every author copies and every reviewer skips.
//
// So this is the manifest's DEFAULT LAYER and `pack.mjs` states only what neither
// the tree nor silence can: the pack's version, its routing guidance, an actual
// fingerprint, its adoption questions. Discovery was already structural — a
// directory with a pack.mjs is a pack — and this is the same principle one level
// in.
//
// OVERRIDE, NOT REPLACEMENT. A manifest field still wins where it is declared, so
// a pack that genuinely differs says so: `prose: null` beside a RULES.md that is
// documentation rather than injected rules, a `skills` subset that withholds a
// directory from mounting. The merge is a plain spread — the conventions are the
// base object, the manifest the override — which means an explicitly declared
// `null` overrides too, and only an ABSENT field falls through to the tree.
//
// The one filesystem read in the manifest layer. `pack-schema.mjs` stays pure (the
// caller hands it the facts); this module is the caller's other half, so the two
// together are "read the tree, then judge the result".

// The conventional filenames. Named here rather than spelled at each use so the
// convention is one edit, and so a reader looking for "where does RULES.md become
// prose" lands on the answer.
export const PROSE_FILE = 'RULES.md';
export const BADGE_FILE = 'badge.svg';
export const SKILLS_DIR = 'skills';

// A rule's scope is its PLACEMENT — which was always true, and used to mean the
// manifest list it sat in. It now means the directory it sits in, one rung out:
// `<pack>/worldRules/*.mjs` audit repo state, `<pack>/workRules/*.mjs` judge the
// change and the session. The names are the manifest field names they replace, so
// a reader who knows one knows the other, and `RULE_SCOPES` in pack-schema.mjs is
// still the single vocabulary both sides read.
export const RULE_DIRS = ['worldRules', 'workRules'];

// A pack with no fingerprint says nothing at all. `null` is what every reader
// already means by "not fingerprinted" — the declaration is authoritative and the
// drift check stands down in both directions — so silence resolves to it rather
// than to `undefined`, and no reader has to handle a third state.
const UNFINGERPRINTED = { detect: null, marker: null };

// The skill directory names a pack bundles: every subdirectory of `<pack>/skills/`.
// A SKILL.md is NOT required here — a directory may carry only a skill's checks —
// because this answers "what does the pack bundle", and it is `bundledSkillSources`
// (the mount) that asks the narrower "what can a session load". Absent or
// unreadable skills/ reads as none; the registry's own scan reports the unreadable
// case, where it can name the fault.
export function bundledSkillDirs(packDir) {
  const root = join(packDir, SKILLS_DIR);
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {
    return [];
  }
}

// The rule modules in one scope's directory, in filename order: every `*.mjs`
// that is not a test, each default-exporting one rule. A module that fails to
// import, or exports no rule, is reported by the caller — this returns the
// { file, module } pairs and judges nothing, so the loader can name the file in
// its diagnostic.
//
// FILENAME ORDER, not an author's chosen order. A manifest list carried one, and
// nothing downstream depended on it: the runners sort findings themselves and a
// pack's rules never see each other. Sorting here makes the set deterministic
// across filesystems, which the list could not guarantee either.
export function ruleModuleFiles(packDir, scope) {
  const root = join(packDir, scope);
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith('.mjs') && !d.name.endsWith('.test.mjs'))
      .map((d) => d.name)
      .sort()
      .map((name) => join(root, name));
  } catch {
    return [];
  }
}

// What the pack directory named `name` says about itself. `badge` and `prose` are
// omitted rather than nulled when their file is absent, so a pack that declares
// neither and carries neither ends up with the fields simply not present — which
// is what every reader already treats as "no badge" / "no prose".
export function packConventions(packDir, name) {
  const conventions = { id: name, skills: bundledSkillDirs(packDir), ...UNFINGERPRINTED };
  if (existsSync(join(packDir, PROSE_FILE))) conventions.prose = PROSE_FILE;
  if (existsSync(join(packDir, BADGE_FILE))) conventions.badge = BADGE_FILE;
  return conventions;
}

// The manifest as the loader consumes it: the tree's answer, overridden by
// whatever the manifest actually declares. A non-object export is handed back
// untouched — the spec is what reports that, and inventing an object here would
// turn a broken pack into a plausible one.
export function applyPackConventions(mod, packDir, name) {
  if (mod === null || typeof mod !== 'object' || Array.isArray(mod)) return mod;
  return { ...packConventions(packDir, name), ...mod };
}
