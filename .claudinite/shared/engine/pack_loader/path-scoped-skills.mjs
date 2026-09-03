// Path-scoped skills: every skill an active pack bundles that declares
// `force-load-on-file-edits-paths` under its frontmatter `metadata` (the files a
// file tool may touch only with the skill loaded), and the one question both
// readers ask of them —
// which of those skills does THIS path need that the session has not yet loaded.
// The PreToolUse hook (engine/hooks/pretooluse-command.mjs) asks it before a file
// tool runs, so the skill is loaded before the first edit exists; the
// `skill-loaded-before-editing` work rule asks it of the diff at Stop, which is what
// catches an edit the hook never saw (one made through Bash). One resolver, so the
// two cannot disagree about a pattern.
//
// Pattern grammar is the harness's (memory docs, "path-specific rules"): `**` spans
// directories, `*` and `?` stay inside one segment, `{a,b}` expands, everything
// else is literal, and a pattern is matched against the whole repo-relative path —
// so `wiki/**` is the tree and `**/packs/*/RULES.md` is that file at any depth.
import { join } from 'node:path';
import { skillMetadata } from './skill-frontmatter.mjs';

const RE_SPECIALS = /[.+^${}()|[\]\\]/g;

// `{a,b}` groups multiplied out, innermost first, so the matcher below never sees one.
export function expandBraces(glob) {
  const m = /\{([^{}]*)\}/.exec(glob);
  if (!m) return [glob];
  return m[1].split(',').flatMap((alt) => expandBraces(glob.slice(0, m.index) + alt + glob.slice(m.index + m[0].length)));
}

function oneGlobToSource(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      // `**/` — zero or more whole segments; a trailing `**` — anything at all.
      if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(RE_SPECIALS, '\\$&');
  }
  return re;
}

export function globToRegExp(glob) {
  return new RegExp(`^(?:${expandBraces(glob).map(oneGlobToSource).join('|')})$`);
}

// The scoped skills of the given packs, flattened: [{ pack, skill, dir, files, re }], one
// entry per pattern. Callers pass the ACTIVE packs — activation is the registry's
// call, not this module's — so an undeclared pack's skills bind nothing. Read off each
// pack's own `skills` list (the convention fills it from the directory), so a skill the
// manifest withholds is not scoped either.
export function pathScopedSkills(packs) {
  const out = [];
  for (const pack of packs ?? []) {
    if (!pack.dir) continue;
    for (const skill of pack.skills ?? []) {
      const dir = join(pack.dir, 'skills', skill);
      for (const files of skillMetadata(dir).forceLoadPaths) {
        out.push({ pack: pack.id, skill, dir, files, re: globToRegExp(files) });
      }
    }
  }
  return out;
}

// The declarations `path` matches whose skill is not among `loaded`, deduped by
// skill name — the reason to stop an edit, or the empty list that lets it run.
export function missingSkillsFor(path, declarations, loaded) {
  const have = new Set(loaded ?? []);
  const seen = new Set();
  const missing = [];
  for (const d of declarations) {
    if (!d.re.test(path) || have.has(d.skill) || seen.has(d.skill)) continue;
    seen.add(d.skill);
    missing.push(d);
  }
  return missing;
}
