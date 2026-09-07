#!/usr/bin/env node
// Bring a repo's task declarations up to the current scheduling vocabulary: the
// retired `frequency` field (tasks-dispatch DESIGN §5, #1725) folded into
// `preconditions` as the cadence term it always meant, and the `trigger` its
// conditions already implied stated outright. Patched as ANCHORED TEXT, never
// re-serialized — a member's task.json is its author's, and a round-trip would
// rewrite its layout while nothing failed.
//
// Two callers. The `task-cadence-terms` migration record runs this against a
// member's OWN local packs on its nightly update, through the registry's io
// capabilities, so a member converges without anyone remembering to; and the CLI
// below rewrites a checkout by hand — the canon's own packs, or a member that
// wants it done sooner:
//
//   node engine/migrations/task-declarations-to-json.mjs [--root <repo>] [<task dir>…]

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, posix } from 'node:path';
import { pathToFileURL } from 'node:url';

export const TASK_JSON = 'task.json';

// The pack roots a checkout's tasks live under. A member's own are the local
// packs; the canon also carries the shared packs at the repo root.
export const LOCAL_PACK_ROOT = '.claudinite/local/packs';
export const CANON_PACK_ROOT = 'packs';

// The io over a real checkout — the same capability names the migration
// registry's callers build, so the record and the CLI run one rewrite.
export function checkoutIo(root) {
  const abs = (p) => join(root, p);
  return {
    exists: (p) => existsSync(abs(p)),
    read: (p) => (existsSync(abs(p)) ? readFileSync(abs(p), 'utf8') : null),
    write: (p, text) => { mkdirSync(dirname(abs(p)), { recursive: true }); writeFileSync(abs(p), text); },
    listDir: (p) => { try { return readdirSync(abs(p)); } catch { return null; } },
  };
}

// --- the retired `frequency` field --------------------------------------------

// What the field always meant, as the condition that now says it — or null for
// `manual`, which meant no schedule and adds no term. The one mapping the
// contract's door reads (`cadenceTermFor` in packs/claudinite-tasks/calendar.mjs),
// spelled again here because the engine imports no pack; the engine test pins the
// two to each other over every accepted value.
const cadenceTermFor = (frequency) => (frequency === 'manual' ? null : `due:${frequency}`);

// The field wherever it sits: on a line of its own (nearly every declaration's
// layout) or inline in a one-line object. The commas
// around it are captured so the patch keeps exactly the separators the file needs.
const FREQUENCY_FIELD = /(,[ \t]*)?"frequency"[ \t]*:[ \t]*"([^"]*)"([ \t]*,)?/;
const PRECONDITIONS_ARRAY = /"preconditions"[ \t]*:[ \t]*\[([^\]]*)\]/;
// The same field with its separators, for dropping it whole (`withoutField`).
const PRECONDITIONS_FIELD = /(,[ \t]*)?"preconditions"[ \t]*:[ \t]*(\[[^\]]*\])([ \t]*,)?/;

// Patch one task.json's text: the field goes, the cadence term leads the
// `preconditions` list (created in the field's own place where the file stated
// none), a `none` beside it drops, and the array keeps its own layout — inline or
// one entry per line at its own indent. Returns `{ text, term, frequency }`, or
// null where there is no field or where the patch would leave the file unparsable
// (the file is then left alone; the contract reports it as it is).
export function retireFrequencyText(source) {
  const text = String(source ?? '');
  const field = FREQUENCY_FIELD.exec(text);
  if (!field) return null;
  const frequency = field[2];
  const term = cadenceTermFor(frequency);
  const array = PRECONDITIONS_ARRAY.exec(text);

  let out;
  if (array) {
    let stated;
    try { stated = JSON.parse(`[${array[1]}]`); } catch { return null; }
    if (!stated.every((e) => typeof e === 'string')) return null;
    const kept = stated.filter((e) => e.trim() !== 'none');
    const terms = term === null || kept.includes(term) ? kept : [term, ...kept];
    if (terms.length === 0) {
      // `manual` with nothing beside it: no schedule, which a declaration says by
      // stating no "preconditions" at all — both fields go.
      out = withoutField(withoutField(text, PRECONDITIONS_FIELD), FREQUENCY_FIELD);
      try { JSON.parse(out); } catch { return null; }
      return { text: out, term, frequency };
    }
    const multiline = array[1].includes('\n');
    const itemIndent = multiline ? (/\n([ \t]*)"/.exec(array[1])?.[1] ?? '    ') : null;
    const closeIndent = multiline ? (/\n([ \t]*)$/.exec(array[1])?.[1] ?? '  ') : null;
    const rendered = multiline
      ? `"preconditions": [\n${terms.map((t) => `${itemIndent}${JSON.stringify(t)}`).join(',\n')}\n${closeIndent}]`
      : `"preconditions": [${terms.map((t) => JSON.stringify(t)).join(', ')}]`;
    out = text.replace(PRECONDITIONS_ARRAY, rendered);
    out = withoutField(out, FREQUENCY_FIELD);
  } else if (term === null) {
    // `manual` and no list: the field alone goes, and the declaration states nothing.
    out = withoutField(text, FREQUENCY_FIELD);
  } else {
    // The field's own place becomes the list, its separators kept: a one-entry
    // list on its own lines where the field had a line, inline where it was inline.
    const [whole, leading = '', , trailing = ''] = field;
    const lineStart = text.lastIndexOf('\n', field.index) + 1;
    const indent = /^[ \t]*/.exec(text.slice(lineStart))[0];
    const ownLine = text.slice(lineStart, field.index).trim() === '' && /^[ \t]*(\n|$)/.test(text.slice(field.index + whole.length));
    const list = ownLine
      ? `"preconditions": [\n${indent}  ${JSON.stringify(term)}\n${indent}]`
      : `"preconditions": [${JSON.stringify(term)}]`;
    out = text.slice(0, field.index) + leading + list + trailing + text.slice(field.index + whole.length);
  }
  try { JSON.parse(out); } catch { return null; }
  return { text: out, term, frequency };
}

// Remove a field (matched with its separators, groups 1 and 3) from the text. A
// field alone on its line takes the line with it — and, where it was the object's
// last key, the comma the key before it carried; an inline field leaves exactly one
// separator behind.
function withoutField(text, re) {
  const f = re.exec(text);
  const [whole, leading, , trailing] = f;
  const start = f.index;
  const end = start + whole.length;
  const lineStart = text.lastIndexOf('\n', start) + 1;
  const lineEndAt = text.indexOf('\n', end);
  const lineEnd = lineEndAt === -1 ? text.length : lineEndAt;
  const restOfLine = text.slice(lineStart, start) + text.slice(end, lineEnd);
  if (restOfLine.trim() === '') {
    let before = text.slice(0, lineStart);
    if (!trailing) before = before.replace(/,[ \t]*\n$/, '\n');
    return before + text.slice(lineEnd + 1);
  }
  const separator = leading && trailing ? ',' : '';
  const rest = text.slice(end);
  // A key follows: its spacing is the removed field's to give back. None follows
  // (the object's last inline key): the closing brace keeps the space it had.
  return text.slice(0, start) + separator + (trailing ? rest.replace(/^[ \t]+(?=\S)/, leading ? ' ' : '') : rest);
}

// Every `<root>/<pack>/tasks/<task>/` directory under the given pack roots that
// carries a task.json, repo-relative and posix.
export function taskDirsWithJson(packRoots, { listDir, exists }) {
  const out = [];
  for (const root of packRoots) {
    for (const pack of listDir(root) ?? []) {
      const tasks = `${root}/${pack}/tasks`;
      for (const task of listDir(tasks) ?? []) {
        const dir = `${tasks}/${task}`;
        if (exists(`${dir}/${TASK_JSON}`)) out.push(dir);
      }
    }
  }
  return out.sort();
}

// --- the unstated `trigger` -----------------------------------------------------

// Whether a declaration states any condition — the pack's `statesConditions`
// (packs/claudinite-tasks/calendar.mjs), spelled again here because the engine
// imports no pack; the engine test pins the two over one vector set. An entry
// carrying only separators states nothing, which is why this is not a length test.
const statesConditions = (preconditions) => (Array.isArray(preconditions) ? preconditions : [])
  .some((e) => String(e ?? '').split('||').some((alt) => alt.trim() !== ''));

const TRIGGER_FIELD = /(^|[{,\s])"trigger"[ \t]*:/;
// The field goes immediately BEFORE one of these, never after a key: the last key
// of an object carries no comma, so appending past one is what breaks the file.
// `preconditions` first, the pair being one sentence; `expected_outcome` is the
// fallback because the contract requires it, so a declaration always carries one.
const TRIGGER_ANCHORS = [/"preconditions"[ \t]*:/, /"expected_outcome"[ \t]*:/];

// Patch one task.json's text to state the trigger its shape already implied.
// Returns `{ text, trigger }`, or null where the field is already there, the file
// does not parse, no anchor was found, or the patch would leave it unparsable.
// Run AFTER the frequency fold, so the conditions it reads are the final ones.
export function stateTriggerText(source) {
  const text = String(source ?? '');
  if (TRIGGER_FIELD.test(text)) return null;
  let decl;
  try { decl = JSON.parse(text); } catch { return null; }
  if (decl === null || typeof decl !== 'object' || Array.isArray(decl)) return null;
  const trigger = statesConditions(decl.preconditions) ? 'schedule' : 'request';
  const field = `"trigger": ${JSON.stringify(trigger)}`;

  for (const anchor of TRIGGER_ANCHORS) {
    const m = anchor.exec(text);
    if (!m) continue;
    // A key on its own line gets a line of its own at the same indent; one inline
    // in a one-line object gets exactly the separator that object uses.
    const lineStart = text.lastIndexOf('\n', m.index) + 1;
    const indent = text.slice(lineStart, m.index);
    const out = indent.trim() === ''
      ? `${text.slice(0, m.index)}${field},\n${indent}${text.slice(m.index)}`
      : `${text.slice(0, m.index)}${field}, ${text.slice(m.index)}`;
    try { JSON.parse(out); } catch { return null; }
    return { text: out, trigger };
  }
  return null;
}

// Bring the task.json in each directory up to the current scheduling vocabulary:
// the retired `frequency` folded into `preconditions`, and the `trigger` its shape
// implied stated outright. One report line per file changed; a file a patch cannot
// be made to is reported and left.
export async function updateTaskSchedulingFields(taskDirs, io) {
  const applied = [];
  for (const dir of taskDirs) {
    const json = `${dir}/${TASK_JSON}`;
    let source = io.read(json);
    if (source === null) continue;
    if (FREQUENCY_FIELD.test(source)) {
      const patched = retireFrequencyText(source);
      if (!patched) {
        applied.push(`${json}: not rewritten — its "frequency" could not be folded into "preconditions" as text; edit it by hand`);
        continue;
      }
      source = patched.text;
      io.write(json, source);
      applied.push(patched.term === null
        ? `${json}: frequency "${patched.frequency}" dropped — no schedule, so no preconditions`
        : `${json}: frequency "${patched.frequency}" → "${patched.term}", first in preconditions`);
    }
    const stated = stateTriggerText(source);
    if (stated) {
      io.write(json, stated.text);
      applied.push(`${json}: trigger "${stated.trigger}" stated — the answer its conditions already gave`);
    }
  }
  return applied;
}

export async function main(argv = process.argv.slice(2)) {
  let root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const dirs = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = argv[++i];
    else dirs.push(argv[i]);
  }
  const io = checkoutIo(root);
  const named = dirs.map((d) => posix.normalize(relative(root, join(root, d)).split('\\').join('/')));
  const targets = dirs.length ? named : taskDirsWithJson([CANON_PACK_ROOT, LOCAL_PACK_ROOT], io);
  const retired = await updateTaskSchedulingFields(targets, io);
  console.log(retired.length ? retired.join('\n') : 'every task.json already states its scheduling in the current vocabulary');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`task-declarations-to-json failed: ${e.message}`); process.exit(1); });
}
