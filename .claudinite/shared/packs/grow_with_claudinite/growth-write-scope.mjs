import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { finding } from '../../engine/checks/helpers/findings.mjs';
import { runRule } from '../../engine/checks/helpers/work.mjs';
import { buildContext } from '../../engine/checks/helpers/repo-context.mjs';
import { LOCAL_PACKS_SUBDIR, LEGACY_LOCAL_PACKS_SUBDIR } from '../../engine/pack_loader/pack-registry.mjs';

// The write-surface gate for the growth lifecycle's two CAPTURE runs — extract
// and dedup. Their docs bound every edit to the repo's own local packs, and
// extract's PR auto-merges with no human review, so the boundary needs a
// machine guarantee, not a prose request: when a branch carries one of those
// runs' pinned commit subjects, every path it touches — added, modified, or
// deleted — must sit under .claudinite/local/packs/ (the legacy
// .claudinite/local_packs/ accepted during the rename window).
//
// The trigger is the run's whole pinned title, NOT the bare "Claudinite growth:"
// prefix the whole lifecycle shares, because its other runs have wider surfaces
// by design: promote writes the canon under packs/ and skills/ (its own gate is
// canon-curation's promote-scope.mjs), and pack discovery writes the repo-root
// .claudinite-checks.json declaration that activates the pack it authors.
// Keying on the prefix would red both. A run whose title this list doesn't
// carry is simply not this rule's business.
//
// Sibling of that promote-scope gate. Promote can't self-gate — nothing in a
// diff marks it as a promote run, so CI keys on its branch prefix — but a
// capture run marks ITSELF via its title, so this rule self-gates and runs
// everywhere the pack is active: at the session Stop hook (work scope), and as
// a CLI on every PR in the canon repo's CI.
//
// Local packs live under either root during the rename transition; git emits
// '/'-separated paths, so the platform-joined constants are normalized.
const LOCAL_ROOTS = [LOCAL_PACKS_SUBDIR, LEGACY_LOCAL_PACKS_SUBDIR]
  .map((s) => `${s.split(sep).join('/')}/`);

// The capture runs, by the exact titles their task docs pin. `conversation
// extract` is the pre-merge title of extract's conversation half, still in use
// wherever a consumer mounts a canon older than the one-task merge.
const CAPTURE_RUN = /^Claudinite growth: (?:extract lessons|conversation extract|dedup\b)/;

const inSurface = (p) => LOCAL_ROOTS.some((root) => p.startsWith(root));

const rule = {
  id: 'growth-write-scope',
  severity: 'blocking',
  scope: 'work',
  doc: 'packs/grow_with_claudinite/README.md',
  description: 'A growth capture run (extract, dedup) writes only the repo\'s own local packs',
  why: 'extract auto-merges its PR with no human review and dedup runs unattended; a capture run improves the repo\'s packs, so a write outside .claudinite/local/packs/ — the canon it prunes against, or the project\'s own code — escapes the review-by-blast-radius boundary the growth lifecycle is built on',

  run(work) {
    if (work.onDefaultBranch()) return [];
    if (!work.commits.some((m) => CAPTURE_RUN.test(m))) return [];
    const touched = [...new Set([...work.changedFiles, ...work.deleted])];
    return touched
      .filter((p) => !inSurface(p))
      .sort()
      .map((p) => finding(rule, {
        file: p,
        what: `a growth capture run touched ${p}, outside ${LOCAL_ROOTS[0]}`,
        fix: 'a capture run improves the repo\'s packs, never the canon or the project\'s code — keep the whole write surface inside the local packs; a site-tied lesson lands as the owning pack\'s entry naming the site, and lifting one into the canon is the promote stage\'s job',
      }));
  },
};

export default rule;

// CLI body — a CI gate runs this on every PR (self-gating, ~nothing on a
// branch that is not a capture run). In the canon repo the entrypoint is
// canon-curation's growth-scope-gate.mjs (core CI must not name a specific
// pack — the barriers rule); a consumer wiring its own CI would invoke this
// module directly:
// `node .claudinite/shared/packs/grow_with_claudinite/growth-write-scope.mjs [root]`.
//   exit 0 — not a capture run, or every touched path is under the local packs
//   exit 1 — a capture run touched a path outside the local packs
export function runCli(root = process.cwd()) {
  const ctx = buildContext({ root, mode: 'changed' });
  if (!ctx.mergeBase) {
    // Without a merge-base there is no diff — and no branch commits — to read,
    // so there is nothing to self-gate on. Unlike promote-scope (whose CI step
    // already KNOWS it faces a promote PR), refusing here would fail every
    // history-less checkout on ordinary PRs; the Stop-hook run still covers
    // the session side.
    console.log('growth-write-scope: no merge-base with the base branch — nothing to scope.');
    process.exit(0);
  }
  const findings = runRule(rule, ctx);
  if (findings.length) {
    console.error(`growth-write-scope: FAIL — a growth capture run may write only under ${LOCAL_ROOTS[0]}, but this branch also touches ${findings.length} path(s):`);
    for (const f of findings) console.error(`  - ${f.file}`);
    console.error('\nA capture run improves the repo\'s packs, never the canon or the project\'s code — keep the whole write surface inside the local packs.');
    process.exit(1);
  }
  console.log('growth-write-scope: OK — not a capture run, or every touched path is under the local packs.');
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli(process.argv[2] || process.cwd());
}
