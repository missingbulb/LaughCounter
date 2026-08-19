// The logs-prune preprocessing entry point — the script the scheduler runs as
// `node worker.mjs` (cwd = this task dir, bounded by code_work_timeout). The whole
// task: no agent, no dispatch issue.
//
// It holds no decision logic: what is deletable is `prune-logs.mjs`, its sibling in
// this task folder, which is a pure function of the branch listing and the clock.
// This file is the I/O shell:
//
//   1. read `retention_days` off this repo's own declaration (unset = the prune is
//      off — capture-only adoption, and the fail-safe default);
//   2. fetch the orphan `conversation-logs` branch and list it (plain local git —
//      the branch is in this repo, so one tree read beats any REST round-trip);
//   3. delete every capture past retention, in one commit onto the branch tip.
//
// THE CHECKOUT IS NEVER TOUCHED. The scheduler runs every due task in one checkout,
// so this builds its tree through plumbing against a throwaway index and pushes the
// commit straight from the object store: HEAD, the index and the working tree are
// where the next task left them, and a run that dies leaves nothing to clean up.
//
// AND THE BRANCH'S HISTORY IS NEVER REWRITTEN. The push is a fast-forward on the
// branch's own tip — plain remove commits, exactly what the capture step's add
// commits are. A capture landing between the fetch and the push loses the race
// benignly: the push is rejected, and the retry re-plans against the new tip.

import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_BRANCH } from '../../capture-log.mjs';
import { planPrune } from './prune-logs.mjs';

const PUSH_ATTEMPTS = 3;

const item = process.env.CLAUDINITE_ITEM || '';
const log = (s) => console.log(`logs-prune${item ? ` [#${item}]` : ''}: ${s}`);

const git = (root, args, opts = {}) => execFileSync('git', ['-C', root, ...args], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts,
});

// This repo's declared retention, or null when the pack is declared without it.
// Anything unparsable is "unset" — the prune's one failure direction is deleting
// what it should not, so an unreadable declaration must not become a number.
export function readRetentionDays(root) {
  let config;
  try { config = JSON.parse(readFileSync(join(root, '.claudinite-checks.json'), 'utf8')); } catch { return null; }
  const entry = (config?.packs ?? []).find((p) => (typeof p === 'string' ? p : p?.id) === 'claudinite-growth');
  const days = typeof entry === 'object' ? entry?.config?.retention_days : undefined;
  return typeof days === 'number' && days > 0 ? days : null;
}

// Commit the removals onto `tip` and push. Plumbing only — see the header.
function pushRemovals(root, { remote, tip, paths, message }) {
  const index = join(tmpdir(), `claudinite-prune-${process.pid}-${Date.now()}.index`);
  const plumb = (args) => git(root, args, { env: { ...process.env, GIT_INDEX_FILE: index } });
  try {
    plumb(['read-tree', tip]);
    for (const path of paths) plumb(['update-index', '--force-remove', path]);
    const tree = plumb(['write-tree']).trim();
    const commit = git(root, [
      '-c', 'user.name=claudinite[bot]', '-c', 'user.email=claudinite@users.noreply.github.com',
      'commit-tree', tree, '-p', tip, '-m', message,
    ]).trim();
    git(root, ['push', '--quiet', remote, `${commit}:refs/heads/${DEFAULT_BRANCH}`]);
    return commit;
  } finally { rmSync(index, { force: true }); }
}

export async function main() {
  const root = process.env.CLAUDINITE_REPO_ROOT || process.cwd();
  const repo = process.env.CLAUDINITE_REPO || process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo) throw new Error('CLAUDINITE_REPO / GITHUB_REPOSITORY is not set (owner/repo)');
  if (!token) throw new Error('GITHUB_TOKEN is not set — the prune cannot read or write the logs branch');
  const remote = `https://x-access-token:${token}@github.com/${repo}.git`;

  const retentionDays = readRetentionDays(root);
  if (retentionDays === null) {
    log('retention_days is unset for this repo — capture-only adoption, deleting nothing');
    return;
  }
  if (!git(root, ['ls-remote', '--heads', remote, DEFAULT_BRANCH]).trim()) {
    log(`no ${DEFAULT_BRANCH} branch — nothing captured yet`);
    return;
  }

  for (let attempt = 1; ; attempt += 1) {
    git(root, ['fetch', '--quiet', remote, DEFAULT_BRANCH]);
    const tip = git(root, ['rev-parse', 'FETCH_HEAD']).trim();
    const names = git(root, ['ls-tree', '--name-only', tip]).split('\n').filter(Boolean);
    const plan = planPrune({ names, retentionDays, now: new Date().toISOString() });

    if (plan.delete.length === 0) {
      log(`${plan.logCount} capture(s) on the branch, none past ${retentionDays}d`);
      return;
    }

    try {
      pushRemovals(root, {
        remote,
        tip,
        paths: plan.delete,
        message: `Claudinite: prune ${plan.delete.length} conversation log(s) past ${retentionDays}d retention [skip ci]`,
      });
    } catch (e) {
      // Almost always a capture that landed mid-run: re-plan against the new tip.
      if (attempt >= PUSH_ATTEMPTS) throw e;
      log(`push rejected (attempt ${attempt}/${PUSH_ATTEMPTS}) — re-planning against the new tip`);
      continue;
    }
    log(`pruned ${plan.delete.length} of ${plan.logCount} capture(s), past ${retentionDays}d`);
    return;
  }
}

// Run only when invoked directly (the scheduler's `node worker.mjs`), never on import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`logs-prune failed: ${e.message}`); process.exit(1); });
}
