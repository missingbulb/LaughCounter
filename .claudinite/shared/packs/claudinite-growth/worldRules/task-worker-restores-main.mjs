import { finding } from '../../../engine/checks/helpers/findings.mjs';

// A local task's worker script: .claudinite/local/packs/<pack>/tasks/<task>/worker.sh
// (the legacy .claudinite/local_packs/ path is accepted during the rename window).
//
// Grounded case only: a shell worker's `git` calls are literal shell tokens a
// regex can see. A `.mjs`/`.js` worker driving git through `execFileSync('git',
// [...])` has no reliable text signature for the same check, so it stays out of
// scope here rather than earning a regex that would silently miss most of it.
const WORKER = /^\.claudinite\/local(?:\/packs|_packs)\/[^/]+\/tasks\/[^/]+\/worker\.sh$/;

// The writing acts this check cares about — a worker that only reads can be left
// wherever the scheduler put it.
const WRITES = /^[^#\n]*\bgit\s+(?:commit|push)\b/m;

// Restoring the checkout: `git checkout main` / `git switch main`, ignoring comments.
const RESTORES = /^[^#\n]*\bgit\s+(?:checkout|switch)\s+main\b/m;

const rule = {
  id: 'task-worker-restores-main',
  severity: 'blocking',
  since: '2026-09-06',
  description:
    'a local task worker that commits or pushes returns the checkout to `main` first',
  why:
    'the Claudinite scheduler runs every due task in ONE checkout, so a worker ordered after ' +
    'anything that leaves the tree on another branch (a maintenance flow\'s `git checkout -B`, ' +
    'never switched back) inherits it silently — a bare `git push origin HEAD:main` from an ' +
    'upstream-less branch aborts with exit 128, and code that only pushes on success can leave ' +
    'that failure unnoticed for days',
  doc: 'packs/claudinite-growth/skills/writing-tasks/SKILL.md',

  run(ctx) {
    const findings = [];

    for (const file of ctx.files) {
      if (!WORKER.test(file)) continue;

      const src = ctx.read(file);
      if (src === null) continue; // relevance-first: unreadable, not this check's business

      const write = WRITES.exec(src);
      if (!write) continue; // a read-only worker cannot lose a commit to the wrong branch

      const restore = RESTORES.exec(src);

      if (!restore) {
        findings.push(finding(rule, {
          file,
          what: `${file} commits or pushes without ever returning the checkout to \`main\``,
          fix: fix(file),
        }));
        continue;
      }

      if (restore.index > write.index) {
        findings.push(finding(rule, {
          file,
          what: `${file} returns the checkout to \`main\` only after it has already committed or pushed`,
          fix: fix(file),
        }));
      }
    }

    return findings.sort((a, b) => a.file.localeCompare(b.file));
  },
};

function fix(file) {
  return (
    `before ${file} writes anything, read \`git rev-parse --abbrev-ref HEAD\` and ` +
    '`git checkout main` when it is anything else. Do not reach for `git push origin HEAD:main` ' +
    'instead — from a polluted checkout that pushes an unreviewed prior converge straight to `main`.'
  );
}

export default rule;
