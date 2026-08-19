#!/usr/bin/env node
// THE WORK SCOPE'S CI ENTRY POINT — one command a project's test/CI flow runs to
// have this change judged, as check_the_world.mjs is for the tree.
//
// WHY A SCRIPT AND NOT EIGHT LINES OF YAML. Everything below is decided the same
// way in every repo, and each part is a way for the gate to look green while
// judging nothing:
//
//   THE BASE REF. A work scope with no base resolves to an EMPTY DIFF, and an
//   empty diff passes every rule silently. A CI checkout carries no
//   origin/<default> unless something fetches it, so this fetches it and fails
//   loudly when it cannot — never proceeds baseless.
//
//   THE AUTOMATION BRANCHES. A member's maintenance and update PRs are opened by
//   the engine on `claudinite/…` branches, with no session and no issue behind
//   them. Judged as work, they fail task-lifecycle for lacking a task they never
//   had — and since delivery arms auto-merge, which is a queue for CHECKS, a red
//   check there does not annoy anyone: it stops the repo updating, permanently
//   and quietly. So they are skipped, out loud.
//
//   THE EMPTY SCOPE. The runner prints nothing on a clean sweep and nothing on a
//   sweep that judged nothing. This prints the scope either way, so a green step
//   says what it actually looked at.
//
// Living in engine/ is what makes it a fleet mechanism rather than a recipe:
// the engine root vendors wholesale on every converge, so a member's workflow
// carries one invocation that never changes, and this logic converges to every
// member the moment it changes here.
//
//   node .claudinite/shared/engine/checks/ci-work-scope.mjs     (a member)
//   node engine/checks/ci-work-scope.mjs                        (the canon home)
//
// Options: --root DIR (default cwd), --branch NAME (default: the checkout's
// branch — CI checks out a detached head, so a workflow passes it explicitly).
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_REF_CANDIDATES } from './helpers/repo-context.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const RUNNER = join(HERE, 'check_the_work.mjs');

// The prefix the engine opens its own PRs under (update, maintenance, and every
// generated-artifact delivery). Named here rather than matched loosely: a repo's
// own branch called "claudinite-something" is a person's branch and is judged.
export const AUTOMATION_PREFIX = 'claudinite/';

export const isAutomationBranch = (branch) => (branch ?? '').startsWith(AUTOMATION_PREFIX);

const git = (root, ...args) => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? (r.stdout ?? '').trim() : null;
};

// The base ref to judge against: the first candidate that exists after trying to
// fetch it. Fetching is what a fresh CI checkout needs and a developer's clone
// does not, so a failure to fetch is not fatal on its own — only a candidate that
// resolves nowhere afterwards is.
export function resolveBase(root, { fetch = true } = {}) {
  for (const ref of BASE_REF_CANDIDATES) {
    const remote = /^([^/]+)\/(.+)$/.exec(ref);
    if (fetch && remote) {
      git(root, 'fetch', '--no-tags', '--quiet', remote[1], `+refs/heads/${remote[2]}:refs/remotes/${remote[1]}/${remote[2]}`);
    }
    if (git(root, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`) !== null) return ref;
  }
  return null;
}

// What this invocation should do, as a decision separate from doing it: every
// outcome is one of these four, and each names why in words a log reader can act
// on. `code` is the process exit; `run` is the only outcome that sweeps.
export function decide(root, { branch, fetch = true } = {}) {
  if (isAutomationBranch(branch)) {
    return { run: false, code: 0, say: `work scope: skipped on ${branch} — an engine-authored branch has no session and no issue behind it` };
  }
  const base = resolveBase(root, { fetch });
  if (!base) {
    return { run: false, code: 1, say: `work scope: no base branch resolved (tried ${BASE_REF_CANDIDATES.join(', ')}) — the sweep would judge an empty diff and pass` };
  }
  const head = git(root, 'rev-parse', 'HEAD');
  const baseSha = git(root, 'rev-parse', `${base}^{commit}`);
  if (head && head === baseSha) {
    return { run: false, code: 0, say: `work scope: skipped — HEAD is ${base}, so there is no change to judge` };
  }
  const changed = (git(root, 'diff', '--name-only', `${base}...HEAD`) || '').split('\n').filter(Boolean);
  if (!changed.length) {
    return { run: false, code: 1, say: `work scope: no diff against ${base} — the sweep would judge nothing and pass` };
  }
  return { run: true, code: 0, base, changed, say: `work scope: ${changed.length} changed file(s) vs ${base}` };
}

export function main(argv = [], { root = process.cwd() } = {}) {
  const value = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : null);
  const at = value('--root') || root;
  const branch = value('--branch') ?? git(at, 'rev-parse', '--abbrev-ref', 'HEAD');
  const verdict = decide(at, { branch });
  console.log(verdict.say);
  if (!verdict.run) return verdict.code;
  const swept = spawnSync(process.execPath, [RUNNER, '--changed', '--base', verdict.base, '--root', at],
    { cwd: at, stdio: 'inherit' });
  return swept.status === null ? 1 : swept.status;
}

// Executed, not imported: the tests drive main() directly.
if (process.argv[1] && process.argv[1].endsWith('ci-work-scope.mjs')) process.exit(main(process.argv.slice(2)));
