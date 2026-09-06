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

// The declarations `hit` admits whose skill is not among `loaded`, deduped by
// skill name — the reason to stop an action, or the empty list that lets it run.
// `loaded` may be the names or a function producing them: the function is called
// only once a declaration hits, so the transcript behind it is read only when a
// verdict actually depends on it.
function missing(declarations, loaded, hit) {
  let have = null;
  const seen = new Set();
  const out = [];
  for (const d of declarations) {
    if (!hit(d) || seen.has(d.skill)) continue;
    have ??= new Set((typeof loaded === 'function' ? loaded() : loaded) ?? []);
    if (have.has(d.skill)) continue;
    seen.add(d.skill);
    out.push(d);
  }
  return out;
}

export const missingSkillsFor = (path, declarations, loaded) => missing(declarations, loaded, (d) => d.re.test(path));

// The TRIGGERED skills of the given packs, the three moments beside the path
// one: [{ pack, skill, dir, kind: 'toolCall' | 'prompt' | 'toolResult', tool,
// pattern, source }], one entry per trigger, read off the same skill metadata.
export function triggeredSkills(packs) {
  const out = [];
  for (const pack of packs ?? []) {
    if (!pack.dir) continue;
    for (const skill of pack.skills ?? []) {
      const dir = join(pack.dir, 'skills', skill);
      const meta = skillMetadata(dir);
      for (const t of meta.toolCallTriggers ?? []) out.push({ pack: pack.id, skill, dir, kind: 'toolCall', tool: t.tool, field: t.field, pattern: t.pattern, source: t.source });
      for (const p of meta.promptTriggers ?? []) out.push({ pack: pack.id, skill, dir, kind: 'prompt', tool: null, pattern: p.re, source: p.source });
      for (const t of meta.toolResultTriggers ?? []) out.push({ pack: pack.id, skill, dir, kind: 'toolResult', tool: t.tool, field: t.field, pattern: t.pattern, source: t.source });
    }
  }
  return out;
}

const namesTool = (d, name) => (d.tool instanceof RegExp ? d.tool.test(name) : d.tool === name);
const asText = (v) => (typeof v === 'string' ? v : JSON.stringify(v ?? {}));
// The text a trigger's regex reads: the named field of the input (a dot path),
// or the whole input as JSON when the trigger names none.
const subjectOf = (d, value) => {
  if (!d.field) return asText(value);
  const at = d.field.split('.').reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), value);
  return at === undefined || at === null ? '' : asText(at);
};

// A call ({ name, input }) about to run, or recorded: the tool-call triggers it
// hits whose skill the session has not loaded.
export const missingSkillsForCall = (call, declarations, loaded) => missing(declarations, loaded,
  (d) => d.kind === 'toolCall' && namesTool(d, call.name) && (!d.pattern || d.pattern.test(subjectOf(d, call.input))));

// An owner prompt: the prompt triggers its text hits.
export const missingSkillsForPrompt = (text, declarations, loaded) => missing(declarations, loaded,
  (d) => d.kind === 'prompt' && d.pattern.test(text ?? ''));

// A call's result: the result triggers it hits.
export const missingSkillsForResult = (call, output, declarations, loaded) => missing(declarations, loaded,
  (d) => d.kind === 'toolResult' && namesTool(d, call.name) && d.pattern.test(subjectOf(d, output)));
