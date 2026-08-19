// Deliver GENERATED files on a pull request that lands itself — the write half of
// an agentless task whose whole output is a regenerated file.
//
// It exists because two tasks need exactly this and must not each grow their own
// copy: the per-repo skill-usage fold and the sheepdog's fleet aggregate both
// recompute a `*.GENERATED.json` from scratch and want it landed without a human in
// the loop. (the update runner's own delivery is deliberately NOT folded in here: it
// commits a whole working tree and re-cuts a dated family branch each cycle — a
// different job that happens to end in a PR too. What the two DO share — every
// nuance of actually landing the PR under the member's `maintenance.delivery` and
// the repo's own shape — lives in land-pr.mjs, and both call it.)
//
// Two properties everything here is shaped around:
//
//   NOTHING TOUCHES THE CHECKOUT. One executor run drains several items from ONE
//   checkout, so a task that checks a branch out hands the next one a tree it did not
//   expect.
//   Every write goes through git plumbing (hash-object / read-tree into a throwaway
//   index / write-tree / commit-tree / push), against the fetched base tip — HEAD,
//   the index and the working tree are never touched, and there is nothing to clean
//   up if the run dies.
//
//   THE BASE IS THE ONLY AUTHORITY. Both the prior state a generator reads and the
//   tree it builds on come from the remote base branch, never from local HEAD. A
//   previous run's PR still sitting open is simply rebuilt from the base, so a
//   stateless generator stays idempotent no matter how many runs stack up. The
//   member's delivery preference is read from the base too, for the same reason.
//
// Idempotence is the caller's to keep: pass files whose content is a pure function of
// the inputs, and compare against `readAtBase` before calling — an identical
// recompute should open nothing at all.

import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deliveryFromChecks, pullCreateError, landDelivery } from './land-pr.mjs';

const API = 'https://api.github.com';

const git = (root, args, opts = {}) => execFileSync('git', ['-C', root, ...args], {
  encoding: 'utf8',
  // A generated file can be large, and a `git show` of one easily tops spawn's
  // default 1 MiB buffer — which fails as a truncated read, not as an error.
  maxBuffer: 256 * 1024 * 1024,
  // stdin is 'pipe' exactly when there is input to pipe: an explicit 'ignore' with an
  // `input` set silently feeds the child NOTHING, and `hash-object --stdin` then
  // cheerfully writes the empty blob — a wrong answer, not an error.
  stdio: [opts.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  ...opts,
});

async function gh(token, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, json };
}

export const remoteUrl = (repo, token) => `https://x-access-token:${token}@github.com/${repo}.git`;

// The base branch's remote tip, fetched into this checkout's object store. Read from
// the REMOTE, never from HEAD — see the header.
export function baseTip(root, remote, base) {
  git(root, ['fetch', '--quiet', remote, base]);
  return git(root, ['rev-parse', 'FETCH_HEAD']).trim();
}

// One file's content at a commit, or null when the path does not exist there.
export function readAt(root, sha, path) {
  try { return git(root, ['show', `${sha}:${path}`]); } catch { return null; }
}

// Commit `files` ({ path: content }) onto the base tip and push to `branch`,
// force — the content is regenerated wholesale each run, so the branch is a
// regenerate-not-reconcile surface.
export function pushGenerated(root, { remote, baseSha, branch, files, message }) {
  const index = join(tmpdir(), `claudinite-deliver-${process.pid}-${Date.now()}.index`);
  const plumb = (args, opts) => git(root, args, { ...opts, env: { ...process.env, GIT_INDEX_FILE: index } });
  try {
    plumb(['read-tree', baseSha]);
    for (const [path, content] of Object.entries(files)) {
      const blob = git(root, ['hash-object', '-w', '--stdin'], { input: content }).trim();
      plumb(['update-index', '--add', '--cacheinfo', `100644,${blob},${path}`]);
    }
    const tree = plumb(['write-tree']).trim();
    const commit = git(root, [
      '-c', 'user.name=claudinite[bot]', '-c', 'user.email=claudinite@users.noreply.github.com',
      'commit-tree', tree, '-p', baseSha, '-m', message,
    ]).trim();
    git(root, ['push', '--quiet', '--force', remote, `${commit}:refs/heads/${branch}`]);
    return commit;
  } finally { rmSync(index, { force: true }); }
}

// Deliver `files` on a PR that lands itself where the member allows it. An open PR
// whose head branch carries `branchPrefix` is REUSED — a daily regenerate that runs
// before yesterday's PR merged updates that PR rather than stacking a second one —
// otherwise a `<branchPrefix>/<stamp>` branch is minted and a PR opened on it.
//
// How the PR lands is land-pr.mjs's business, not the calling task's: the member's
// `maintenance.delivery` (read from the BASE tip — a `review` member's PR is opened
// and left for the owner; an unrecognized value fails the run rather than guessing),
// then the repo's own shape (no PR CI → direct merge; ungated base → verify-then-
// land; a gate → arm auto-merge, landing poll as fallback). A PR this run could not
// land stays open — the next run rebuilds it from the base, so nothing is lost.
//
// Returns { branch, number, reused, delivery, merged }.
export async function deliverGenerated({ root, repo, base, token, branchPrefix, stamp, files, title, body, message, log = console.log }) {
  const { json: pulls } = await gh(token, `/repos/${repo}/pulls?state=open&per_page=100`);
  let pr = (Array.isArray(pulls) ? pulls : []).find((p) => p.head?.ref?.startsWith(`${branchPrefix}/`));
  const reused = Boolean(pr);
  const branch = reused ? pr.head.ref : `${branchPrefix}/${stamp}`;
  const remote = remoteUrl(repo, token);

  const baseSha = baseTip(root, remote, base);
  // The member's delivery preference gates everything after the push. Same stance
  // as the update converge: an absent key resolves to the default (materializing it is the
  // converge's job, not a generated-file PR's), an unrecognized value fails loudly
  // — substituting a default would deliver the opposite of a stated intent.
  const { delivery } = deliveryFromChecks(readAt(root, baseSha, '.claudinite-checks.json'));
  if (!delivery) throw new Error('this repo\'s maintenance.delivery is neither auto-merge nor review — fix .claudinite-checks.json');

  const commit = pushGenerated(root, { remote, baseSha, branch, files, message });

  if (!reused) {
    const created = await gh(token, `/repos/${repo}/pulls`, { method: 'POST', body: { head: branch, base, title, body } });
    const failure = pullCreateError(created.status, created.json);
    if (failure) throw new Error(`opening the pull request for ${branch}: ${failure}`);
    pr = created.json;
  }

  let merged = false;
  if (pr?.number) {
    // Runs for review members too: landDelivery still starts the PR's checks
    // (#565 — the GITHUB_TOKEN push emitted no pull_request run, and the owner
    // reviews against a green), then does nothing further for `review`.
    // The head sha must be THIS run's commit: a reused PR's listing still carries
    // the previous push, and polling a stale sha waits on runs that never come.
    const landed = await landDelivery({
      token, repo, base, delivery, log,
      pr: { ...pr, head: { ...pr.head, ref: branch, sha: commit } },
    });
    merged = landed.merged;
  }
  return { branch, number: pr?.number ?? null, reused, delivery, merged };
}
