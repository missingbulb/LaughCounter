// THE TARGET — which pull request a run works on (tasks-dispatch DESIGN §6.4b,
// decision §15.32). A task's `expected_outcome` says what its run does to pull
// requests; the executor resolves that into a concrete branch and pull request
// ONCE, after the precondition said go and before code-work, and hands the
// answer to both phases (code-work as environment, the agent as item fields).
// Neither phase discovers, chooses or disposes of a pull request on its own —
// that was three independent decisions in three places, and a task could not
// even say "append to my open pull request".
//
// A task's open pull requests are recognised two ways, either sufficient: the
// branch prefix this module mints (`claudinite/<pack>/<task>/`), or the
// `Claudinite-Task:` trailer on the pull request's head commit — the authority the
// movement signals already read, which is what still finds a pull request a lane
// opened under its own branch name before the executor minted them.
//
// `planTarget` is pure over what was read; `resolveTarget` is the I/O shell that
// reads it. A read the shell cannot make is `{ error }` — a run failure the
// executor parks, never a guess: an unreadable pull request list looks exactly
// like an empty one, and "nothing to amend" on that evidence stacks a duplicate.

import { pullDisposition } from '../land-pr.mjs';
import { taskFromMessage, taskTrailer } from '../task-trailer.mjs';
import { canonicalOutcome, opensPullRequest } from '../task-contract.mjs';

export const TARGET_MODES = Object.freeze(['none', 'fresh', 'amend']);

// Every branch the executor mints lives under one root, and every task under its
// own prefix beneath it — which is what makes the prefix a family, not a guess.
export const BRANCH_ROOT = 'claudinite';
export const taskBranchPrefix = (taskId) => `${BRANCH_ROOT}/${taskId}/`;

// One branch per run, dated and seeded: two runs on one day must not collide, and
// a name that carries its date is one a person can read a week later.
export const mintBranch = (taskId, now, seed) =>
  `${taskBranchPrefix(taskId)}${new Date(now).toISOString().slice(0, 10)}-${seed}`;
export const newSeed = () => Math.random().toString(36).slice(2, 8);

// This task's open pull requests, newest first. `headTaskOf(pr)` answers which task
// the pull request's head commit names, for the ones the prefix does not settle.
export function taskPullsOf(pulls, taskId, headTaskOf = () => null) {
  const prefix = taskBranchPrefix(taskId);
  return (pulls ?? [])
    .filter((p) => String(p?.head?.ref ?? '').startsWith(prefix) || headTaskOf(p) === taskId)
    .sort((a, b) => b.number - a.number);
}

// What a target becomes in code-work's environment — three variables in every
// mode, so a worker can tell "no target" from "an executor that sets none".
export const targetEnv = (target) => ({
  CLAUDINITE_TARGET_MODE: target?.mode ?? 'none',
  CLAUDINITE_TARGET_BRANCH: target?.branch ?? '',
  CLAUDINITE_TARGET_PR: target?.pr == null ? '' : String(target.pr),
});

// The decision, pure. `incumbents` are this task's open pull requests newest
// first; `mergeable` is the newest one's answer where the outcome amends;
// `disposition` is `pullDisposition`'s verdict on the newest where the outcome
// supersedes, with `merge` meaning the shell already landed it.
//
//   { mode, branch, pr, supersedes, landed, reason }
//   mode      — 'none' | 'fresh' | 'amend'
//   branch    — the branch the run pushes to (null under 'none')
//   pr        — the pull request an amend pushes onto (null otherwise)
//   supersedes — pull requests to close once this run's own exists
//   landed    — the incumbent the shell merged, whose landing ends this occurrence
export function planTarget({ outcome, incumbents = [], mergeable = null, disposition = null, branch }) {
  const canonical = canonicalOutcome(outcome);
  if (!canonical) throw new Error(`"${outcome}" is not a legal outcome ceiling`);
  const none = (reason) => ({ mode: 'none', branch: null, pr: null, supersedes: [], landed: null, reason });
  const fresh = (reason) => ({ mode: 'fresh', branch, pr: null, supersedes: [], landed: null, reason });
  const newest = incumbents[0] ?? null;

  if (!opensPullRequest(canonical)) return none('this task changes no code');
  if (canonical === 'fresh_pr') return fresh('a fresh branch; earlier pull requests of this task are left as they are');

  if (canonical === 'amend_existing_or_create_new_pr') {
    if (!newest) return fresh('no open pull request of this task to amend');
    if (mergeable === true) {
      return {
        mode: 'amend', branch: newest.head.ref, pr: newest.number, supersedes: [], landed: null,
        reason: `amending #${newest.number}, which has no conflicts with its base`,
      };
    }
    if (mergeable === false) return fresh(`#${newest.number} has conflicts with its base, so this run takes a fresh branch`);
    return fresh(`#${newest.number}'s mergeability could not be read, so this run takes a fresh branch rather than push onto it`);
  }

  // supersede_existing_pr
  if (!newest) return fresh('no open pull request of this task to supersede');
  const numbers = incumbents.map((p) => p.number);
  if (disposition === 'merge') {
    // The previous delivery had concluded green and was never landed — the exact
    // member whose CI outruns the landing budget every day, which the next-cycle
    // disposal used to rescue. Landing it is finishing this task's own delivery;
    // the tree this run holds predates that merge, so the occurrence ends here and
    // the next one converges from the moved base.
    return {
      ...none(`landed #${newest.number}, this task's previous delivery, which had concluded green — the occurrence ends there`),
      landed: newest.number, supersedes: numbers.slice(1),
    };
  }
  return {
    mode: 'fresh', branch, pr: null, supersedes: numbers, landed: null,
    reason: `a fresh branch; ${numbers.map((n) => `#${n}`).join(', ')} close as superseded once this run's pull request exists`,
  };
}

const defaultSleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// GitHub computes `mergeable` lazily: the first read after a push answers null
// while it works. Three reads two seconds apart cover the documented delay; an
// answer that never comes plans as unknown, which takes a fresh branch.
const MERGEABLE_READS = 3;
const MERGEABLE_WAIT_MS = 2000;

async function deleteRef(gh, repo, ref, log) {
  if (!ref) return;
  const res = await gh(`/repos/${repo}/git/refs/heads/${encodeURIComponent(ref)}`, { method: 'DELETE' });
  if (res.status !== 204) log(`could not delete branch ${ref} (HTTP ${res.status})`);
}

// The I/O shell. Reads nothing for the two outcomes that involve no existing pull
// request; for the other two, lists the open pull requests, recognises this
// task's, and reads exactly what the plan needs of the newest — its mergeability
// for an amend, the runs on its head for a supersede (landing it there when
// `delivery` allows and the runs concluded green).
export async function resolveTarget({
  gh, repo, taskId, outcome, delivery, now, seed = newSeed(), sleep = defaultSleep, log = console.log,
}) {
  const canonical = canonicalOutcome(outcome);
  if (!canonical) return { error: `"${outcome}" is not a legal outcome ceiling` };
  const branch = mintBranch(taskId, now, seed);
  if (canonical === 'no_code_changes' || canonical === 'fresh_pr') return planTarget({ outcome: canonical, incumbents: [], branch });

  const listed = await gh(`/repos/${repo}/pulls?state=open&per_page=100`);
  if (listed.status !== 200 || !Array.isArray(listed.json)) {
    return { error: `could not list the open pull requests in ${repo} (${listed.status}) — an unreadable list is not an empty one` };
  }
  // One head-commit read per open pull request the prefix does not settle: the
  // trailer is what still recognises a pull request a lane opened under its own
  // branch name before the executor minted them.
  const prefix = taskBranchPrefix(taskId);
  const heads = new Map();
  for (const p of listed.json) {
    if (String(p?.head?.ref ?? '').startsWith(prefix) || !p?.head?.sha) continue;
    const res = await gh(`/repos/${repo}/commits/${p.head.sha}`);
    heads.set(p.number, res.status === 200 ? taskFromMessage(res.json?.commit?.message) : null);
  }
  const incumbents = taskPullsOf(listed.json, taskId, (p) => heads.get(p.number) ?? null);
  const newest = incumbents[0] ?? null;
  if (!newest) return planTarget({ outcome: canonical, incumbents, branch });

  if (canonical === 'amend_existing_or_create_new_pr') {
    let mergeable = null;
    for (let n = 0; n < MERGEABLE_READS; n += 1) {
      if (n) await sleep(MERGEABLE_WAIT_MS);
      const res = await gh(`/repos/${repo}/pulls/${newest.number}`);
      if (res.status !== 200) break;
      if (typeof res.json?.mergeable === 'boolean') { mergeable = res.json.mergeable; break; }
    }
    return planTarget({ outcome: canonical, incumbents, mergeable, branch });
  }

  // supersede_existing_pr — judged by the runs on the newest incumbent's head,
  // exactly as the next-cycle disposal judged it. An unreadable head is `close`:
  // the successor this run opens gets its own chance to land.
  const runsRes = await gh(`/repos/${repo}/actions/runs?head_sha=${newest.head?.sha ?? ''}&per_page=100`);
  const runs = runsRes.status === 200
    ? (runsRes.json?.workflow_runs ?? []).map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion }))
    : null;
  let disposition = runs ? pullDisposition({ delivery, runs }) : 'close';
  if (disposition === 'merge') {
    const res = await gh(`/repos/${repo}/pulls/${newest.number}/merge`, {
      method: 'PUT', body: { merge_method: 'squash', commit_message: taskTrailer(taskId) },
    });
    if (res.status === 200) {
      log(`landed #${newest.number} — ${taskId}'s previous delivery had concluded green and was never merged`);
      await deleteRef(gh, repo, newest.head?.ref, log);
    } else {
      log(`could not land #${newest.number} (${res.status}: ${res.json?.message ?? 'no message'}) — superseding it instead`);
      disposition = 'close';
    }
  }
  return planTarget({ outcome: canonical, incumbents, disposition, branch });
}

// Close the pull requests a run superseded, now that its own (`successor`) exists:
// a comment saying by what, the close, and the dead branch tidied. Best-effort
// throughout — the successor is the deliverable, and one already closed by hand,
// or unreadable, is logged and left.
export async function closeSuperseded({ gh, repo, numbers = [], successor, log = console.log }) {
  for (const number of numbers) {
    const read = await gh(`/repos/${repo}/pulls/${number}`);
    if (read.status !== 200) { log(`could not close #${number} (${read.status}) — leaving it`); continue; }
    await gh(`/repos/${repo}/issues/${number}/comments`, {
      method: 'POST', body: { body: `Superseded by #${successor}, a later run of the same task. Closing this one.` },
    });
    const closed = await gh(`/repos/${repo}/pulls/${number}`, { method: 'PATCH', body: { state: 'closed' } });
    if (closed.status !== 200) { log(`could not close #${number} (${closed.status}) — leaving it`); continue; }
    log(`closed #${number} — superseded by #${successor}`);
    await deleteRef(gh, repo, read.json?.head?.ref, log);
  }
}
