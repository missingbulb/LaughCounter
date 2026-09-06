import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

// Session-transcript parsing for conversation-surface rules (Stop hook only —
// CI has no transcript, so rules must return [] when ctx.conversation() is null).
// A Claude Code transcript is JSONL; the shapes this reads were verified against
// a real session file, not inferred: an owner turn is `type: "user"` with plain
// string message content (tool results arrive as content arrays, injected/meta
// turns carry isMeta, subagent traffic carries isSidechain, and synthetic turns
// — hook output, reminders, webhook activity — are tag-wrapped, starting with "<").

export function parseEntries(text) {
  const entries = [];
  for (const line of (text || '').split('\n')) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { /* partial trailing write — skip the line */ }
  }
  return entries;
}

function humanText(entry) {
  if (entry.type !== 'user' || entry.isMeta || entry.isSidechain) return null;
  const content = entry.message?.content;
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content) && content.length && content.every((c) => c?.type === 'text')
      ? content.map((c) => c.text).join('\n')
      : null;
  if (!text || text.trimStart().startsWith('<')) return null;
  return text;
}

// The owner's own turns, in order: [{ index, timestamp, text }].
export function humanTurns(entries) {
  const turns = [];
  entries.forEach((entry, index) => {
    const text = humanText(entry);
    if (text !== null) turns.push({ index, timestamp: entry.timestamp ?? null, text });
  });
  return turns;
}

// Concatenated assistant text emitted after entry `fromIndex`, up to the next
// owner turn (or the end of the session).
export function assistantTextAfter(entries, fromIndex) {
  const parts = [];
  for (let i = fromIndex + 1; i < entries.length; i += 1) {
    const entry = entries[i];
    if (humanText(entry) !== null) break;
    if (entry.type !== 'assistant') continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === 'text' && block.text) parts.push(block.text);
    }
  }
  return parts.join('\n');
}

// The explicit classification line, if the reply carries one.
export function classificationLine(text) {
  const m = /^[ \t>#*_-]*comment\s+class\b[^:\n]*:(.*)$/im.exec(text || '');
  return m ? m[0] : null;
}

// Canonical class tokens named on a classification line (a mixed comment may
// name several): 'correction' | 'feature' | 'process-change' | 'other'.
export function classesIn(line) {
  const classes = new Set();
  for (const m of (line || '').matchAll(/correction|feature|process[\s-]change|other/gi)) {
    classes.add(m[0].toLowerCase().replace(/\s+/g, '-'));
  }
  return classes;
}

// Each owner turn with the classes its reply declared (empty set = unclassified).
export function classifiedTurns(entries) {
  return humanTurns(entries).map((turn) => ({
    ...turn,
    classes: classesIn(classificationLine(assistantTextAfter(entries, turn.index))),
  }));
}

// Every tool call the session made, in order: [{ index, name, input, sidechain }]
// — each `tool_use` block on an assistant entry. Subagent (sidechain) calls
// count, flagged: a guard a delegated call breaks is still broken.
export function toolCalls(entries) {
  const denials = deniedCalls(entries);
  const calls = [];
  (entries ?? []).forEach((entry, index) => {
    if (entry?.type !== 'assistant') return;
    const content = entry.message?.content;
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (block?.type !== 'tool_use' || typeof block.name !== 'string') continue;
      calls.push({
        index, name: block.name, input: block.input ?? {}, sidechain: Boolean(entry.isSidechain),
        deniedBy: denials.get(block.id) ?? [],
      });
    }
  });
  return calls;
}

// A call the PreToolUse guard denied never ran: the harness records the hook's
// stderr as that call's error result, and an action guard's denial names its
// rule there — `Blocked by <rule-id>: …`, the line engine/hooks/pretooluse-judge.mjs
// writes. Map of tool_use id → the rule ids that denied it, so the Stop-time
// backstop can tell a call that ran past a hook from one the hook held.
const DENIAL = /(?:^|\n)Blocked by ([\w.-]+):/g;
function deniedCalls(entries) {
  const out = new Map();
  for (const entry of entries ?? []) {
    if (entry?.type !== 'user') continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type !== 'tool_result' || !block.is_error || typeof block.tool_use_id !== 'string') continue;
      const text = typeof block.content === 'string' ? block.content
        : Array.isArray(block.content) ? block.content.map((c) => (typeof c?.text === 'string' ? c.text : '')).join('\n') : '';
      const rules = [...text.matchAll(DENIAL)].map((m) => m[1]);
      if (rules.length) out.set(block.tool_use_id, rules);
    }
  }
  return out;
}

// Every skill the session has loaded so far, in order of loading — the body
// reached the context by any of three routes:
//  - the `input.skill` of a `Skill` tool_use block on an assistant entry;
//  - a `Read` tool_use that opened the skill's own SKILL.md;
//  - a slash command the owner typed (`/do-later …`), which the harness expands
//    itself and records as a `<command-name>` block in the user turn rather than
//    as any tool call — the Skill tool's own contract: "if a `<command-name>`
//    block is already present this turn, the skill is loaded". The leading
//    slash is dropped; a plugin prefix (`plugin:skill`) is kept, so a plugin's
//    skill never passes for a pack's skill of the same bare name.
// Subagent (sidechain) entries count: a skill a delegated edit loaded was
// loaded for that edit.
// The usage fold's own `commandName` reads the same block: a pack cannot
// depend on a fresh engine export, since the two lanes deliver on separate
// cadences, so the grammar is spelled twice and a drift guard in
// engine-tests/pack_loader/path-scoped-skills.test.mjs holds them together.
const SKILL_FILE = /(?:^|\/)skills\/([^/]+)\/SKILL\.md$/;
const COMMAND_NAME = /<command-name>\s*\/?([A-Za-z0-9:_-]+)\s*<\/command-name>/g;

export function skillLoads(entries) {
  const names = [];
  for (const entry of entries ?? []) {
    const content = entry?.message?.content;
    if (entry?.type === 'user') {
      const text = typeof content === 'string' ? content
        : Array.isArray(content) ? content.map((b) => (typeof b?.text === 'string' ? b.text : '')).join('\n') : '';
      for (const m of text.matchAll(COMMAND_NAME)) names.push(m[1]);
      continue;
    }
    if (entry?.type !== 'assistant' || !Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type !== 'tool_use') continue;
      if (block.name === 'Skill' && typeof block.input?.skill === 'string') names.push(block.input.skill);
      const read = block.name === 'Read' && typeof block.input?.file_path === 'string' && SKILL_FILE.exec(block.input.file_path);
      if (read) names.push(read[1]);
    }
  }
  return names;
}

// Every transcript file one session writes: the `<session-id>.jsonl` every hook
// payload and the Stop hook name, plus each subagent's own stream at
// `<session-id>/subagents/agent-<agent-id>.jsonl` beside it. A subagent's tool
// calls go only to its own file, and no payload before SubagentStop names the
// calling agent, so what the SESSION did — the skills it loaded, the calls it
// made — is read across the whole set, never the session file alone (#1735).
// Owner turns are the exception and stay with that file: the harness writes a
// subagent's prompt as a user entry too, and it is not the owner speaking.
export function sessionTranscriptPaths(transcriptPath) {
  if (!transcriptPath) return [];
  const paths = existsSync(transcriptPath) ? [transcriptPath] : [];
  const subagents = join(dirname(transcriptPath), basename(transcriptPath).replace(/\.jsonl$/, ''), 'subagents');
  let names;
  try { names = readdirSync(subagents); } catch { return paths; } // no delegated work this session
  for (const name of names.sort()) {
    if (name.startsWith('agent-') && name.endsWith('.jsonl')) paths.push(join(subagents, name));
  }
  return paths;
}
