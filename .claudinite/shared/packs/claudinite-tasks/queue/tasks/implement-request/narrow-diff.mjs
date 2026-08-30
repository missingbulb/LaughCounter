// The queue's pre-policy "narrow diff" verdict, kept for the items and callers
// that still speak it. The general mechanism is `merge-policy.mjs` at this
// pack's root — `Merge: if-narrow` resolves there to the `narrow-diff` composite
// policy, and new callers go straight to that module and its CLI. What stays
// here is the original whole-diff verdict shape (`narrowVerdict`) and its CLI,
// both built on the primitives merge-policy now owns.
//
// Narrow means every changed file is one of:
//   - documentation — a Markdown/text file;
//   - a test — a file or directory the repo names as one;
//   - comments only — the code either side of the change is identical once the
//     comments are stripped;
//   - code, in at most ONE directory across the whole diff.
//
// THE LIMIT THAT BOUNDS THE VERDICT: a file `commentOnly` cannot answer for counts
// as code, so a comment-only edit in a language the parser does not model parks the
// run rather than merging it. That is the safe end, and it is deliberate — the
// verdict grants a merge nobody will look at.

import path from 'node:path';
import {
  COMMENT_CHECKABLE, commentOnly, classifyPath, diffEntries,
} from '../../../merge-policy.mjs';

// Re-exported so a caller that asked this module keeps getting the same answers
// the policy engine gives.
export { COMMENT_CHECKABLE, commentOnly, classifyPath, diffEntries };

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
