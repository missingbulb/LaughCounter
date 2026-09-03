// A skill's own declaration: the YAML frontmatter at the top of its SKILL.md, read
// for the fields the corpus acts on — `name`, `description` (what the harness
// matches a session's activity against) and, under `metadata`, the corpus's own
// `force-load-on-file-edits-paths`: the files a file tool may touch only with this
// skill loaded (the PreToolUse guard holds the edit until it is). `metadata` is the
// map the harness reserves for a reader's own keys and never acts on, which is why
// the scope lives there and not in the harness's `paths` — that field LIMITS when
// the harness offers a skill, and a skill forced for some files is often wanted
// elsewhere too. The rest of the frontmatter is the harness's business.
//
// A deliberate subset of YAML, never a general parser: `key: scalar`, a block list
// under a key (`- item`), one level of nested map under a key, quoted or bare
// scalars, and a comma-separated scalar where a list is expected. Anything else is
// left unread, and a file with no frontmatter — or a malformed one — reads as a skill
// with empty metadata, which is what the harness does with it too.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const FORCE_LOAD_KEY = 'force-load-on-file-edits-paths';

const unquote = (s) => {
  const t = s.trim();
  return (t.length >= 2 && ((t[0] === '"' && t.at(-1) === '"') || (t[0] === "'" && t.at(-1) === "'")))
    ? t.slice(1, -1) : t;
};
const scalar = (rest) => {
  const flow = /^\[(.*)\]$/.exec(rest.trim());
  return flow ? flow[1].split(',').map(unquote).filter(Boolean) : unquote(rest);
};

export function parseFrontmatter(text) {
  const out = {};
  if (!text.startsWith('---')) return out;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return out;
  const lines = text.slice(text.indexOf('\n') + 1, end).split('\n');
  // The container the next indented line lands in: a list, or a nested map (one
  // level, with its own lists), keyed by indentation so a dedent closes it.
  let top = null;   // { key, indent } of the open top-level container
  let inner = null; // { key, indent } of the open key inside a nested map
  for (const line of lines) {
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    const item = /^\s+-\s*(.*)$/.exec(line);
    if (item && indent > 0 && top) {
      const target = inner && indent > inner.indent ? out[top.key][inner.key] : out[top.key];
      if (Array.isArray(target)) target.push(unquote(item[1]));
      continue;
    }
    const kv = /^(\s*)([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, , key, rest] = kv;
    if (indent > 0 && top) {
      // A key inside the open top-level container turns it into a map.
      if (Array.isArray(out[top.key]) && !out[top.key].length) out[top.key] = {};
      if (typeof out[top.key] !== 'object' || Array.isArray(out[top.key])) continue;
      out[top.key][key] = rest.trim() === '' ? [] : scalar(rest);
      inner = { key, indent };
      continue;
    }
    inner = null;
    if (rest.trim() === '') { out[key] = []; top = { key, indent }; continue; }
    top = null;
    out[key] = scalar(rest);
  }
  return out;
}

// The forced-load scope as a list whatever its spelling — a block list, a flow list,
// or one comma-separated string — read from `metadata`.
export function forceLoadPathsOf(fm) {
  const v = fm?.metadata && typeof fm.metadata === 'object' && !Array.isArray(fm.metadata) ? fm.metadata[FORCE_LOAD_KEY] : undefined;
  if (Array.isArray(v)) return v;
  return typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

// The metadata of the skill at `dir`: { name, description, forceLoadPaths }.
// Unreadable is empty metadata, on the harness's own terms.
export function skillMetadata(dir) {
  let fm = {};
  try { fm = parseFrontmatter(readFileSync(join(dir, 'SKILL.md'), 'utf8')); } catch { /* no SKILL.md */ }
  return {
    name: typeof fm.name === 'string' ? fm.name : '',
    description: typeof fm.description === 'string' ? fm.description : '',
    forceLoadPaths: forceLoadPathsOf(fm),
  };
}
