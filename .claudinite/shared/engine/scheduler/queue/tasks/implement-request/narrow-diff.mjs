// Is this run's diff NARROW — small enough that the asker said, up front, they did
// not want to be asked (tasks-dispatch DESIGN §16.11)? The request task's ceiling
// allows a merge; THIS is what decides whether one happens, so the call is
// arithmetic over the diff rather than the session's opinion of its own work.
//
// Narrow means every changed file is one of:
//   - documentation — a Markdown/text file;
//   - a test — a file or directory the repo names as one;
//   - comments only — the code either side of the change is identical once the
//     comments are stripped;
//   - code, in at most ONE directory across the whole diff.
//
// So a change that edits one module, its tests, a README and a comment in a file
// somewhere else is narrow; one that edits code in two directories is not.
//
// TWO LIMITS, stated because they bound what the verdict means. Comment stripping
// is C-family (`//`, `/* */`) — a file whose language this parser does not model
// is never called comments-only, it counts as code, which is the safe end. And the
// comparison ignores indentation and blank lines, so a whitespace-only edit inside
// a template literal reads as comments-only; in a language where indentation is
// semantic the file is not comment-checkable in the first place.

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { stripComments } from '../../../../checks/helpers/code-scanning.mjs';

// The extensions whose comments `stripComments` actually models. Anything else is
// counted as code even when the change was a comment — a verdict this module is
// not sure of is a verdict of "ask the human".
export const COMMENT_CHECKABLE = new Set([
  '.mjs', '.cjs', '.js', '.jsx', '.ts', '.tsx', '.c', '.h', '.cc', '.cpp', '.hpp',
  '.java', '.go', '.swift', '.kt', '.dart', '.rs', '.cs', '.scss', '.css',
]);

const DOC_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.rst']);

const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'spec', 'specs', 'fixtures', 'testdata']);

// A path's kind, from the path alone: 'doc', 'test', or 'code'. Directory names
// are matched on whole segments (`tests/`), never on substrings, so `latest/` is
// not a test directory; file names are matched on the conventions every ecosystem
// here shares.
export function classifyPath(file) {
  const segments = file.split('/');
  const name = segments[segments.length - 1];
  if (segments.slice(0, -1).some((seg) => TEST_DIRS.has(seg) || seg.endsWith('-tests') || seg.endsWith('_tests'))) return 'test';
  if (/(^|[.\-_])(test|tests|spec)[.\-_]/i.test(name) || /^test_/i.test(name)) return 'test';
  if (DOC_EXTENSIONS.has(path.extname(name).toLowerCase())) return 'doc';
  return 'code';
}

// Did the change touch only comments? Absent content on either side (an add or a
// delete) is not a comment-only change, and a language this parser does not model
// answers false.
export function commentOnly(file, before, after) {
  if (before == null || after == null) return false;
  if (!COMMENT_CHECKABLE.has(path.extname(file).toLowerCase())) return false;
  const meat = (text) => stripComments(text).split('\n').map((l) => l.trim()).filter((l) => l !== '').join('\n');
  return meat(before) === meat(after);
}

// The verdict over a whole diff. `entries` are `{ file, before, after }`, contents
// null where the file was added or deleted. Returns the verdict and the WHY —
// which files forced it — because a run that parks has to say what it parked over.
export function narrowVerdict(entries) {
  const codeDirs = new Map();
  const kinds = [];
  for (const { file, before, after } of entries) {
    const kind = classifyPath(file);
    if (kind !== 'code') { kinds.push({ file, kind }); continue; }
    if (commentOnly(file, before, after)) { kinds.push({ file, kind: 'comments' }); continue; }
    const dir = path.dirname(file);
    if (!codeDirs.has(dir)) codeDirs.set(dir, []);
    codeDirs.get(dir).push(file);
    kinds.push({ file, kind: 'code' });
  }
  const dirs = [...codeDirs.keys()].sort();
  return {
    narrow: dirs.length <= 1,
    codeDirs: dirs,
    files: kinds,
    why: dirs.length <= 1
      ? (dirs.length === 0
        ? 'no code changed — documentation, tests and comments only'
        : `code changed in one directory (${dirs[0]}), beside documentation, tests and comment-only edits`)
      : `code changed in ${dirs.length} directories: ${dirs.join(', ')}`,
  };
}

// --- the CLI ------------------------------------------------------------------

// `stderr: ignore` because the ONE expected failure here — `git show` on a path
// that does not exist at that ref — is how an added or deleted file answers, and
// letting git narrate it once per such file buries the verdict the caller reads.
const git = (args, cwd) => execFileSync('git', args, {
  cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
});

// The content of `file` at `ref`, or null when it does not exist there (an added
// file) — the same answer a deleted file's "after" gets.
function contentAt(ref, file, cwd) {
  try {
    return git(['show', `${ref}:${file}`], cwd);
  } catch {
    return null;
  }
}

// The diff this branch carries against `base`, read from the merge base so
// commits that landed on the base meanwhile are not counted as this run's work.
export function diffEntries({ base, cwd = process.cwd() }) {
  // The checkouts these runs work in are shallow, where `merge-base` has no common
  // ancestor to find; the base ref itself is then the honest comparison point.
  let mergeBase;
  try {
    mergeBase = git(['merge-base', base, 'HEAD'], cwd).trim();
  } catch {
    mergeBase = base;
  }
  const names = git(['diff', '--name-only', mergeBase, 'HEAD'], cwd).split('\n').map((l) => l.trim()).filter(Boolean);
  return names.map((file) => ({
    file,
    before: contentAt(mergeBase, file, cwd),
    after: contentAt('HEAD', file, cwd),
  }));
}

async function main() {
  const argv = process.argv.slice(2);
  const at = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : null);
  const cwd = at('--root') ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const base = at('--base') ?? 'origin/main';

  const entries = diffEntries({ base, cwd });
  if (entries.length === 0) {
    console.log('NARROW: no — this branch changes nothing against the base');
    return;
  }
  const verdict = narrowVerdict(entries);
  for (const { file, kind } of verdict.files) console.log(`  ${kind.padEnd(8)} ${file}`);
  console.log(`\nNARROW: ${verdict.narrow ? 'yes' : 'no'} — ${verdict.why}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`narrow-diff: ${e.message}`); process.exitCode = 1; });
}
