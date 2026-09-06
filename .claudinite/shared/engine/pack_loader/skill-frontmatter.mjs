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
// The other three moments a skill may force itself for, under `metadata` too:
// a tool call, an owner prompt, a tool result. An entry is one scalar — single-
// quote it in the frontmatter, since a regex carries backslashes:
//   force-load-on-tool-calls:          - 'mcp__github__create_pull_request'
//                                      - 'Bash.command /(^|[;&|]\\s*)git\\s+commit\\b/'
//   force-load-on-prompts-matching:    - '/\\bLGTM\\b/'
//   force-load-on-tool-results-matching: - 'WebFetch /EGRESS_BLOCKED|\\b403\\b/'
// A tool entry is the tool's exact name — optionally `.field`, the input field
// the regex reads (`Bash.command`) — or a /regex/ over names, then optionally a
// space and a /regex/ over that field, or over the whole input (or the result)
// serialized as JSON when no field is named.
export const TOOL_CALL_KEY = 'force-load-on-tool-calls';
export const PROMPT_KEY = 'force-load-on-prompts-matching';
export const TOOL_RESULT_KEY = 'force-load-on-tool-results-matching';

const RE_FORM = /^\/(.*)\/([a-z]*)$/s;
const toRegExp = (s) => { const m = RE_FORM.exec(String(s).trim()); try { return m ? new RegExp(m[1], m[2]) : null; } catch { return null; } };
const listAt = (fm, key) => {
  const v = fm?.metadata && typeof fm.metadata === 'object' && !Array.isArray(fm.metadata) ? fm.metadata[key] : undefined;
  return Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? [v] : [];
};

// "<tool>", "<tool>.<field>", either with " /regex/" → { tool (name or RegExp),
// field (a dot path into the input, or null), pattern (RegExp or null), source };
// a malformed entry is null (dropped, never a wedged hook).
export function parseToolTrigger(entry) {
  const m = /^(\/(?:[^/\\]|\\.)*\/[a-z]*|[^\s/][^\s]*)(?:\s+(\/.*\/[a-z]*))?$/s.exec(String(entry).trim());
  if (!m) return null;
  let tool = m[1];
  let field = null;
  if (tool.startsWith('/')) { tool = toRegExp(tool); if (tool === null) return null; }
  else if (tool.includes('.')) { [tool, ...field] = tool.split('.'); field = field.join('.'); }
  const pattern = m[2] ? toRegExp(m[2]) : null;
  if (m[2] && !pattern) return null;
  return { tool, field, pattern, source: String(entry).trim() };
}
export const toolCallTriggersOf = (fm) => listAt(fm, TOOL_CALL_KEY).map(parseToolTrigger).filter(Boolean);
export const toolResultTriggersOf = (fm) => listAt(fm, TOOL_RESULT_KEY).map(parseToolTrigger).filter(Boolean);
export const promptTriggersOf = (fm) => listAt(fm, PROMPT_KEY)
  .map((s) => ({ re: toRegExp(s), source: String(s).trim() })).filter((p) => p.re);

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

// The metadata of the skill at `dir`: { name, description, forceLoadPaths,
// toolCallTriggers, promptTriggers, toolResultTriggers }.
// Unreadable is empty metadata, on the harness's own terms.
export function skillMetadata(dir) {
  let fm = {};
  try { fm = parseFrontmatter(readFileSync(join(dir, 'SKILL.md'), 'utf8')); } catch { /* no SKILL.md */ }
  return {
    name: typeof fm.name === 'string' ? fm.name : '',
    description: typeof fm.description === 'string' ? fm.description : '',
    forceLoadPaths: forceLoadPathsOf(fm),
    toolCallTriggers: toolCallTriggersOf(fm),
    promptTriggers: promptTriggersOf(fm),
    toolResultTriggers: toolResultTriggersOf(fm),
  };
}
