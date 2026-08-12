// baselining worker — the DETERMINISTIC self-refresh, as prework
// (task-prework DESIGN §7, E4). This is `agent_model: 'sonnet'` with
// `prework: 'node worker.mjs'`, so the scheduler runs THIS FILE as a
// subprocess (cwd = this task dir) bounded by `prework_timeout`,
// BEFORE any agent. It absorbs everything about the nightly refresh that is
// dependency-free code — so most nights are AGENTLESS and quiet, and an agent is
// requested only when real judgment is left (owner decision, 2026-07-23):
//
//   agent requested  ⇔  a pending AGENTIC migration note exists
//                    OR  the converge changed things AND check_the_world is not green.
//   no change, or changed-but-green with no agentic note  →  agentless night.
//
// What it does, Action-side, over the one sanctioned non-MCP surface (the Action
// GITHUB_TOKEN in env) and a direct PUBLIC canon fetch (owner §10: canon is
// public — no token, no tarball channel):
//   1. shallow-clone canon at its head sha (then drop .git → a rootless tree, so
//      apply-vendor-set skips the ancestry guards that a shallow clone can't
//      satisfy — it is head by construction);
//   2. run the CLONED canon's vendoring/apply-vendor-set.mjs to converge
//      .claudinite/shared/ and stamp it (compute+apply, one snapshot);
//   3. run the cloned converge-wiring.mjs (scheduler workflow + hashed cron + the
//      tasks' declared required_secrets, settings hooks, retired-import removal),
//      and ask the owner for any declared secret the repo hasn't configured;
//   4. apply the MECHANICAL migration notes (aliases/materialize/rewrite/declarePacks)
//      via the cloned engine/migrations/apply.mjs — idempotent — and re-converge the mount
//      when that changed the DECLARATION, since a newly declared pack's content was
//      not in the set the vendor pass computed a moment earlier;
//   5. detect pending AGENTIC notes (registry.mjs `agenticMigrations`, gated on
//      the prior stamp day, same-day inclusive #330) and, if any, HOLD the stamp
//      at the day before the earliest one so the agent still sees the note (the
//      stamp/agentic coupling rule);
//   6. deliver the converge as ONE commit on the per-cycle maintenance branch via
//      NATIVE git (dispose of the family's open PR — merge it if its own runs
//      verified it, else close it — then cut a fresh dated branch and open the
//      PR), arming auto-merge per the
//      member's `maintenance.delivery` and DISPATCHING the repo's PR CI on the
//      branch — the GITHUB_TOKEN push emits no pull_request run of its own
//      (#565), so the checks the arm waits on must be started explicitly;
//   7. request the agent (write CLAUDINITE_REQUEST_AGENT) only when judgment is
//      left — the scheduler files `ready-for-agent` iff this file appears (§3,
//      conditional handoff). NO code→agent data channel: the file is a pure
//      control signal; the agent discovers its work by reading the repo (the
//      pushed branch, the pending note).
//
// Imports: node builtins, plus the vendored ENGINE SURFACE — the one import the
// pack-independence barrier sanctions. The delivery/landing nuances live in
// `engine/scheduler/land-pr.mjs` (one home for every PR-delivering task; its
// helpers grew here and moved out), vendored beside this worker and loaded at
// process start — so the mid-run mount overwrite (apply-vendor-set rewriting the
// tree this process is executing from) can never mix an old worker with new
// landing logic. The vendoring/migrations machinery stays canon-internal
// (vendoring/ is never vendored, #385), so the worker INVOKES the
// freshly-fetched canon's scripts as subprocesses and DYNAMIC-imports its
// registry from the temp clone path — never a static import of that code.
//
// This SUPERSEDES the per-cycle maintenance-branch naming of PR #407 (that PR
// reworked the OLD fleet-apply MCP path; baselining's delivery is native git
// Action-side and carries its own prefix/find-by-prefix here).

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
// The shared landing helpers (see the header note): delivery resolution, the
// PR-open status check, and the whole arm/land/merge decision live there — this
// worker keeps only what is baselining-shaped (the family branch and its
// close-and-recut disposal).
import {
  resolveDelivery, pullCreateError, landDelivery,
  pullDisposition, mergeReason, failureSummary, deleteBranch,
} from '../../../../engine/scheduler/land-pr.mjs';
// The skew guard, from the engine so BOTH mechanisms read one definition (#768).
import { servedBy } from '../../../../engine/served-by.mjs';

const CANON_URL = 'https://github.com/missingbulb/Claudinite.git'; // public — no token
const MAINT_PREFIX = 'claudinite/maintenance';
const API = 'https://api.github.com';

// --- pure helpers (exported, unit-tested git-free) --------------------------

// Note selection moved to the version gate (#768 Phase 4): a note is pending while
// its record is in this repo's gap, decided by `migrationApplies` in the engine —
// the one predicate that also decides what a mount fetches and what a check
// tolerates. The date-window selector that lived here is gone with the hold below;
// nothing can now disagree about whether a record still applies.

// The stamp is no longer HELD for a pending note (#768 Phase 4). Holding it kept a
// note selected across runs while the date decided selection; version-ranged
// selection needs no such trick, because a record leaves the gap only when the
// version carrying its change is installed. Removing the hold is what makes
// `claudinite.updated` mean one thing again — when this repo last converged.

// A per-cycle maintenance branch name — dated + a short seed so each cycle gets a
// distinct branch (superseding #407's scheme, native-git side). `seed` is passed
// in so this is pure; main() generates it.
export function maintenanceBranchName(dateStr, seed) {
  return `${MAINT_PREFIX}-${dateStr}-${seed}`;
}

// The family's open maintenance PR, found by head-branch PREFIX (the name carries
// a per-cycle seed, so the prefix is what identifies the family): the cycle
// DISPOSES of this one — merge or close — before cutting its own, which is what
// keeps them from piling up night-over-night. null → nothing to dispose of. The
// whole PR is returned, not just its ref, because disposal needs its number and
// head sha.
export function openMaintenancePull(pulls, prefix = MAINT_PREFIX) {
  return (pulls ?? []).find((pr) => String(pr?.head?.ref ?? '').startsWith(prefix)) ?? null;
}

// Its head branch alone — the shape most callers want.
export function openMaintenanceBranch(pulls, prefix = MAINT_PREFIX) {
  return openMaintenancePull(pulls, prefix)?.head?.ref ?? null;
}

// The paths this stage is STRUCTURALLY UNABLE to deliver. deliver() pushes with the
// Action's GITHUB_TOKEN, and GitHub refuses to let that token create or update anything
// under `.github/workflows/` — there is no `permissions:` key that grants it. The refusal
// is remote-side and rejects the WHOLE ref, so a workflow file left in the commit fails
// the entire push, taking the mount convergence, the wiring and every other note with it.
//
// So the converge withholds exactly these paths and hands them to the AGENT stage, whose
// writes go through the session's MCP GitHub tools — a credential that does hold the
// `workflows` permission. The agent re-runs the same mechanical apply in its own checkout
// to produce them.
//
// It covers `convergeWiring`'s scheduler workflow as much as any pack-owned one.
export const UNPUSHABLE_PREFIX = '.github/workflows/';
export function withheldWorkflowPaths(changedPaths) {
  return (changedPaths ?? []).filter((p) => p.startsWith(UNPUSHABLE_PREFIX));
}

// The escalation decision (owner, 2026-07-23): agent iff a pending agentic note,
// or a real change the deterministic converge left non-green. No change, or a
// green change with no agentic note, stays agentless.
//
// It returns the REASON, not a bit — `null` for an agentless night, otherwise
// `{ code, detail }`. The worker knew which of four conditions fired and then threw
// it away; the agent it woke re-derived all four from scratch, and on
// EdFringeAllocator#82 re-derived them WRONG (it reported "preprocessing created
// nothing" about a cycle that had merged its PR a second earlier) and closed a
// six-minute run as a no-op. `code` is the stable identifier a consumer branches on;
// `detail` is the sentence a human reads in the dispatch issue.
//
// It names the CONDITION and its counts, never the findings themselves — those stay
// in the repo for the agent to re-run (DESIGN §3, the no-code→agent-data-channel rule;
// the named exception is identity, not content).
//
// The branch ORDER is the escalation precedence, most-specific first: a night with a
// pending note and a red check is a note night, because the note is what the agent
// must apply and the red check may well be the note's own doing.
export function escalation({
  pendingCount, meaningfulChange, checksPass, selftestOk = true, withheldCount = 0,
  checksCrashed = false, selftestCrashed = false,
}) {
  if (pendingCount > 0) {
    return { code: 'agentic-notes', detail: `${pendingCount} pending agentic migration note(s) to apply` };
  }
  // A withheld workflow file is work this stage COULD not do, not work it chose to
  // leave: without the agent, the file simply never lands, and the converge would
  // report itself clean while the repo stays un-updated.
  if (withheldCount > 0) {
    return {
      code: 'withheld-workflows',
      detail: `${withheldCount} workflow file(s) the Action token cannot push — only the agent's credential can land them`,
    };
  }
  // A converged mount that cannot pass its own self-test is the judgment case
  // whether or not the converge "changed" anything a diff can see: broken
  // machinery reports no findings precisely because it is not running.
  if (!selftestOk) {
    return selftestCrashed
      ? { code: 'selftest-could-not-run', detail: 'the converged mount\'s self-test could not run at all — machinery, not content' }
      : { code: 'selftest-failed', detail: 'the converged mount FAILED its self-test — the machinery that runs the rules is not intact' };
  }
  if (Boolean(meaningfulChange) && !checksPass) {
    return checksCrashed
      ? { code: 'checks-could-not-run', detail: 'check_the_world could not run on the converged tree — no verdict was produced' }
      : { code: 'checks-not-green', detail: 'check_the_world reported findings on the converged tree that the deterministic pass could not fix' };
  }
  return null;
}

// The same decision as a bit, for the callers that only need the verdict. Derived
// rather than reimplemented — two copies of a four-branch precedence is exactly the
// drift the corpus forbids.
export function shouldRequestAgent(signals) {
  return escalation(signals) !== null;
}

// The scheduler hands the worker a path to signal the agent through; writing it
// requests the agent stage (run.mjs files `ready-for-agent` iff it appears).
export const AGENT_REQUEST_MARKER = 'agent-requested';

// --- I/O shell (validated by the live pilot, not unit tests) ----------------

const git = (args, opts = {}) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
// `opts` exists for ONE reason: `cwd`. This worker's own cwd is the task dir INSIDE the
// mount (prework.mjs spawns it there), and step 2 deletes that whole tree before
// re-copying it — so from the vendor step onward this process is running in an unlinked
// directory, and every child it spawns inherits it. A child that calls `process.cwd()`
// dies with `ENOENT … uv_cwd` (#689). Children are therefore pointed at the repo root,
// which is the directory they were always meant to be working in.
const node = (args, extraEnv = {}, opts = {}) =>
  execFileSync(process.execPath, args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...extraEnv }, ...opts,
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

// The outcome of running one gate script, from what `node()` threw (or didn't).
// PURE, so the four shapes are testable without a repo on disk.
//
// `catch { return false }` was the whole of this before, and it collapsed four
// different events into one indistinguishable bit: findings, a crash, a signal kill,
// and a script that isn't there. `node()` already pipes stdout/stderr, so the
// findings were in the thrown error's `.stdout` all along and the bare catch dropped
// them — leaving the escalation they caused unexplainable after the fact
// (EdFringeAllocator#82: a run that escalated on a check which passes everywhere it
// can be re-run, with no record of what it saw).
//
// `crashed` is the distinction that matters most: a non-zero EXIT is a verdict about
// the repo's content, while a null status — signal kill, spawn failure — means no
// verdict was produced at all. Both still escalate to the agent (a gate that cannot
// answer is not permission to proceed), but they are no longer the same sentence.
export function gateOutcome(error) {
  if (!error) return { ok: true, ran: true, crashed: false, status: 0, output: '' };
  const status = Number.isInteger(error.status) ? error.status : null;
  const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
  return { ok: false, ran: true, crashed: status === null, status, output };
}

// A gate that isn't vendored at all is nothing to run — not a failure. Distinct from
// `crashed`, which is a gate that exists and could not answer.
export const GATE_ABSENT = Object.freeze({ ok: true, ran: false, crashed: false, status: null, output: '' });

// Run check_the_world against the converged repo. Green means it exited clean (no
// blocking findings); anything else is judgment left, with the reason attached.
function runCheckTheWorld(root) {
  const cw = join(root, '.claudinite/shared/engine/checks/check_the_world.mjs');
  if (!existsSync(cw)) return GATE_ABSENT; // no vendored checks to gate on
  try { node([cw], { CLAUDE_PROJECT_DIR: root }, { cwd: root }); return gateOutcome(null); }
  catch (e) { return gateOutcome(e); }
}

// REHEARSAL MODE (per-project-scheduling rehearsal, #593 phase 0). A run may be
// pointed at a canon BRANCH instead of its default head, so a canon change can be
// tried against a real repo before it merges. `CLAUDINITE_CANON_REF` selects the
// ref; `CLAUDINITE_CANON_URL` a fork.
//
// The stamp is the whole reason this needs its own decision rather than an extra
// clone argument. A branch head is NOT on trunk, and stamping it is precisely the
// shape vendoring's #328 anti-rewind guard refuses to write over afterwards
// (`ref-not-on-trunk`, which the sheepdog freshness sweep reads as WEDGED, not
// late) — a rehearsal would leave the repo unable to baseline ever again. This
// was not hypothetical: it happened by hand on 2026-07-30, to all thirteen
// members at once, from a converge run out of an unmerged branch.
//
// So a rehearsal stamps NOTHING. It converges, it reports, and it leaves the
// member's provenance exactly as it found it.
export function canonSource(env = {}) {
  const ref = String(env.CLAUDINITE_CANON_REF ?? '').trim();
  const url = String(env.CLAUDINITE_CANON_URL ?? '').trim() || CANON_URL;
  return { url, ref: ref || null, rehearsal: Boolean(ref) };
}

// Run the engine's self-test against the converged tree; green when the machinery
// is intact. Same soft shape as runCheckTheWorld — a missing selftest (an older
// mount that predates it) is not a failure, it is nothing to run.
function runSelfTest(root) {
  const st = join(root, '.claudinite/shared/engine/selftest.mjs');
  if (!existsSync(st)) return GATE_ABSENT;
  try { node([st, '--strict'], { CLAUDE_PROJECT_DIR: root }, { cwd: root }); return gateOutcome(null); }
  catch (e) { return gateOutcome(e); }
}

// What a gate said, for the LOG — the full text, not a summary. This is the one
// place the findings belong: the Action log is an observability surface nothing
// reads programmatically, so it carries everything, while the dispatch issue
// carries only the condition (preprocess.mjs, the §3 exception).
function logGateOutput(label, outcome) {
  const body = outcome.output ? `\n${outcome.output}` : ' (no output)';
  console.log(`baselining: ${label} ${outcome.crashed ? 'COULD NOT RUN' : `exited ${outcome.status}`} —${body}`);
}

// Deliver the converge as one commit on a FRESH per-cycle maintenance branch,
// native git: dispose of the family's open PR first (merge it if last cycle's
// content is verified, otherwise close it), then cut a new dated branch + PR and
// arm auto-merge when the member asked for it.
//
// Nothing is reused. A maintenance PR is one cycle's deterministic converge, and
// a cycle that did not land has nothing to hand the next one — inheriting it is
// what turned a single failed arm into a PR that outlived every subsequent cycle
// (#455/#205/#95). The disposal happens BEFORE the converge is pushed, because
// the push would replace the head sha the merge evidence hangs on.
async function deliver(root, repo, base, token, delivery, seed, withheld = []) {
  const { json: pulls } = await gh(token, `/repos/${repo}/pulls?state=open&per_page=100`);
  const openPr = openMaintenancePull(Array.isArray(pulls) ? pulls : []);
  let pr = null;
  let merged = false;

  if (openPr?.number) {
    // `wait` is the one case that keeps the PR: its checks are still running and
    // may yet land it. Skip this cycle entirely rather than race them — the
    // converge is idempotent, so tomorrow simply does it again.
    const kept = await disposeOpenPull(token, repo, openPr, delivery)
      .catch((e) => { console.log(`baselining: disposing of PR #${openPr.number} failed: ${e.message}`); return openPr; });
    if (kept) {
      console.log(`baselining: PR #${openPr.number} still stands — leaving this cycle's converge undelivered`);
      // Same shape as the delivery path below — the caller reads `.branch`/`.pr`
      // unconditionally, and the bare-ref return this used to make crashed it.
      return { branch: kept.head?.ref ?? null, pr: kept.number ?? openPr.number, merged: false };
    }
  }

  const branch = maintenanceBranchName(new Date().toISOString().slice(0, 10), seed);

  git(['-C', root, 'checkout', '-B', branch]);
  git(['-C', root, 'add', '-A']);
  // Withhold what this token cannot push (see withheldWorkflowPaths). Unstaged, not
  // reverted: the file stays in the working tree so nothing here has to reason about
  // restoring it, and the runner is discarded at job end either way. The agent lands
  // them on this same branch afterwards.
  for (const p of withheld) git(['-C', root, 'restore', '--staged', p]);
  // With everything else staged, a converge whose ONLY content was a workflow file has
  // nothing left to commit. It still needs the branch and the PR — that is where the
  // agent does its half — so the commit is allowed to be empty rather than skipped.
  const staged = git(['-C', root, 'diff', '--cached', '--name-only']).split('\n').filter(Boolean);
  const note = withheld.length
    ? `\n\nWithheld for the agent stage (the Action token cannot push a workflow file):\n${withheld.map((p) => `- ${p}`).join('\n')}`
    : '';
  git(['-C', root, '-c', 'user.name=claudinite[bot]', '-c', 'user.email=claudinite@users.noreply.github.com',
    'commit', ...(staged.length ? [] : ['--allow-empty']),
    '-m', `Claudinite maintenance: converge vendored mount, wiring, and migration notes${note}`]);
  const remote = `https://x-access-token:${token}@github.com/${repo}.git`;
  git(['-C', root, 'push', '--force', remote, `HEAD:refs/heads/${branch}`]);

  const body = delivery === 'auto-merge'
    ? 'Automated Claudinite maintenance (deterministic converge + any migration notes). Re-cut each cycle; auto-merges once this repo\'s checks pass.'
    : 'Automated Claudinite maintenance (deterministic converge + any migration notes). Re-cut each cycle; left for your review.';
  const created = await gh(token, `/repos/${repo}/pulls`, {
    method: 'POST', body: { head: branch, base, title: 'Claudinite maintenance', body },
  });
  const failure = pullCreateError(created.status, created.json);
  if (failure) throw new Error(`could not open the maintenance PR for ${branch}: ${failure}`);
  pr = created.json;

  // Land what was just pushed, per the member's delivery and the repo's own
  // shape — the shared helper owns every nuance (land-pr.mjs): it starts the
  // PR's checks (#565), reads what the base branch requires, then merges
  // directly (no PR CI), verifies-then-lands (ungated base — the arm would be
  // rejected "clean status" every cycle, #677), or arms auto-merge with the
  // landing poll as fallback (#649). An arm that still could not land costs one
  // cycle, not forever: the next cycle merges this PR on its concluded runs
  // (pullDisposition) or closes it and re-cuts. Idempotent either way.
  if (pr?.number) {
    const landed = await landDelivery({
      token, repo, base, delivery, pr,
      log: (s) => console.log(`baselining: ${s}`),
    });
    merged = landed.merged;
  }
  // What this cycle delivered. The scheduler records it in the dispatch issue, which is
  // the agent's source for these artifacts.
  return { branch, pr: pr?.number ?? null, merged };
}

// The I/O half of the disposal: read the workflow runs for the open PR's head
// sha, decide with pullDisposition, and either merge it (last cycle's content is
// verified — the arm just never landed it) or close it and delete its branch so
// this cycle re-cuts from scratch. Returns the PR when it still stands (a `wait`,
// a `review` member, or a failed attempt), null when the way is clear.
//
// Best-effort throughout: anything unreadable or unmergeable leaves the PR as it
// found it, and the cycle skips rather than piling a second PR on top.
async function disposeOpenPull(token, repo, pr, delivery) {
  const { status, json } = await gh(token, `/repos/${repo}/actions/runs?head_sha=${pr.head?.sha}&per_page=100`);
  if (status !== 200) {
    console.log(`baselining: could not read the runs for PR #${pr.number}'s head (HTTP ${status})`);
    return pr;
  }
  const runs = (json?.workflow_runs ?? []).map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion }));
  const disposition = pullDisposition({ delivery, runs });

  if (disposition === 'keep' || disposition === 'wait') {
    console.log(`baselining: keeping PR #${pr.number} (${disposition})`);
    return pr;
  }

  if (disposition === 'merge') {
    const res = await gh(token, `/repos/${repo}/pulls/${pr.number}/merge`, {
      method: 'PUT', body: { merge_method: 'squash' },
    });
    if (res.status === 200) {
      console.log(`baselining: merged PR #${pr.number} — ${mergeReason(runs)}`);
      await deleteBranch({ token, repo, ref: pr.head?.ref, log: (s) => console.log(`baselining: ${s}`) });
      return null;
    }
    console.log(`baselining: could not merge PR #${pr.number} (${res.status}: ${res.json?.message ?? 'no message'})`
      + ' — closing it instead; the converge is idempotent and this cycle re-cuts it');
  }

  // Closed, not left to rot: whatever went wrong on that head, the next converge
  // reproduces the same content from the same inputs. Named in the log because a
  // member closing its maintenance PR every single night is a repo whose CI needs
  // a human, and the pattern has to be visible to be noticed.
  const closed = await gh(token, `/repos/${repo}/pulls/${pr.number}`, { method: 'PATCH', body: { state: 'closed' } });
  if (closed.status !== 200) {
    console.log(`baselining: could not close PR #${pr.number} (${closed.status}) — leaving it and skipping this cycle`);
    return pr;
  }
  console.log(`baselining: closed PR #${pr.number} — it did not land (${failureSummary(runs)}); re-cutting this cycle`);
  await deleteBranch({ token, repo, ref: pr.head?.ref, log: (s) => console.log(`baselining: ${s}`) });
  return null;
}

// Ask the owner to add a repo Actions secret a task declares in `required_secrets`
// but the repo has not configured. The wiring converge stamps every declared name
// into the scheduler workflow, so by the time this runs the value is either in the
// environment or genuinely unset — no separate probe needed.
//
// This is the adoption interview's posture, not a gate: nothing fails, no check
// fires, and the task that needs the secret simply doesn't work until someone adds
// it. One open issue per repo (matched by exact title) so an unconfigured secret
// costs one issue, not one per night. Exported for the tests.
export const SECRETS_ISSUE_TITLE = 'Claudinite: configure required Actions secrets';

export function unconfiguredSecrets(declared, env) {
  return (declared ?? []).filter((name) => !env[name]);
}

async function askForSecrets(token, repo, names) {
  const q = encodeURIComponent(`repo:${repo} in:title "${SECRETS_ISSUE_TITLE}" state:open`);
  const { json } = await gh(token, `/search/issues?q=${q}&per_page=10`);
  if ((json?.items ?? []).some((i) => (i.title ?? '').trim() === SECRETS_ISSUE_TITLE)) return false;
  const body = [
    'A scheduled task in this repo declares a repo **Actions secret** that is not configured yet.',
    'Until it is, that task cannot do its work — everything else keeps running normally.',
    '',
    ...names.map((n) => `- \`${n}\``),
    '',
    `Add each one at https://github.com/${repo}/settings/secrets/actions, then close this issue.`,
  ].join('\n');
  await gh(token, `/repos/${repo}/issues`, { method: 'POST', body: { title: SECRETS_ISSUE_TITLE, body } });
  return true;
}

export async function main() {
  const root = process.env.CLAUDINITE_REPO_ROOT || process.cwd();
  const repo = process.env.CLAUDINITE_REPO || process.env.GITHUB_REPOSITORY;
  const base = process.env.CLAUDINITE_DEFAULT_BRANCH || 'main';
  const token = process.env.GITHUB_TOKEN;
  const requestFile = process.env.CLAUDINITE_REQUEST_AGENT;
  // Set by deliver() to `{ branch, pr, merged }`; stays null when this cycle opened
  // nothing, which is what the dispatch issue then says.
  let delivered = null;
  if (!repo) { console.error('baselining: no repo (CLAUDINITE_REPO/GITHUB_REPOSITORY)'); process.exit(1); }
  if (!token) { console.error('baselining: no GITHUB_TOKEN in env'); process.exit(1); }

  const checksPath = join(root, '.claudinite-checks.json');
  if (!existsSync(checksPath)) { console.log('baselining: no .claudinite-checks.json — nothing to self-refresh'); return; }
  const priorRaw = JSON.parse(readFileSync(checksPath, 'utf8'));
  const priorStamp = priorRaw.claudinite ?? {};
  if (!priorStamp.updated && !priorStamp.ref) {
    console.log('baselining: no vendored-mount stamp — nothing to self-refresh (canon home or pre-adoption)');
    return; // quiet, no agent (matches the precondition self-skip)
  }
  // A repo the update flows serve is not this mechanism's to converge (#768's skew
  // risk). Stepping aside is the FIRST thing after reading the declaration and
  // before any clone or write: two mechanisms converging one mount would race on
  // the same files, and the loser's write reads as drift the winner then repairs,
  // nightly, forever. Quiet and agentless — a repo served elsewhere is not an
  // anomaly, so there is nothing here for a human to look at.
  //
  // A member's copy of this worker is only as new as its last converge, so a repo
  // flipped before its mount carries this check keeps baselining for one more
  // cycle. That is the safe direction of that lag: it converges twice by the old
  // mechanism rather than falling between the two.
  const served = servedBy(priorRaw);
  if (served.mechanism !== 'baselining') {
    console.log(`baselining: this repo is served by the ${served.mechanism} flow — standing down`);
    return;
  }
  if (served.invalid !== undefined) {
    console.log(`baselining: maintenance.mechanism "${served.invalid}" is not a mechanism — proceeding as ${served.mechanism}`);
  }

  const { delivery, materialize } = resolveDelivery(priorRaw?.maintenance?.delivery);
  if (!delivery) {
    console.error(`baselining: maintenance.delivery "${priorRaw?.maintenance?.delivery}" is neither auto-merge nor review`);
    process.exit(1);
  }
  // Materialize the missing key BEFORE the converge, so the repair rides this
  // cycle's maintenance commit like any other converged surface.
  if (materialize) {
    priorRaw.maintenance = { ...priorRaw.maintenance, delivery };
    writeFileSync(checksPath, JSON.stringify(priorRaw, null, 2) + '\n');
    console.log(`baselining: maintenance.delivery was missing — materialized "${delivery}"`);
  }

  // 1. Fetch canon at head as a ROOTLESS tree (drop .git so apply-vendor-set's
  //    ancestry guards skip — a shallow clone can't answer them, and it is head
  //    by construction).
  const source = canonSource(process.env);
  const tmp = mkdtempSync(join(tmpdir(), 'claudinite-canon-'));
  git(source.ref
    ? ['clone', '--depth', '1', '--branch', source.ref, source.url, tmp]
    : ['clone', '--depth', '1', source.url, tmp]);
  const headSha = git(['-C', tmp, 'rev-parse', 'HEAD']).trim();
  rmSync(join(tmp, '.git'), { recursive: true, force: true });
  if (source.rehearsal) {
    console.log(`baselining: REHEARSAL against ${source.url}@${source.ref} (${headSha.slice(0, 8)}) — `
      + 'the stamp will be restored, and nothing is delivered');
  }

  // 2-4. Deterministic converge: mount + stamp, then wiring, then mechanical notes.
  node([join(tmp, 'vendoring/apply-vendor-set.mjs'), '--target', root, '--ref', headSha]);
  const wiringOut = node([join(tmp, 'engine/scheduler/converge-wiring.mjs'), repo], { CLAUDINITE_REPO_ROOT: root });
  // The handshake (engine/migrations/registry.mjs, WITHHOLD_CAPABLE_ENV): THIS worker withholds
  // workflow paths from its commit and hands them to the agent, so a record may safely
  // materialize one. An older vendored worker does not set it and the materialization is
  // skipped instead of wedging its push. Set here, by the code that does the withholding,
  // because the question is what the RUNNING process can do — and the disk cannot answer
  // it: apply-vendor-set above has already overwritten this very file with the new
  // version while this old-or-new code is the thing actually executing.
  const declarationBefore = readFileSync(checksPath, 'utf8');
  node([join(tmp, 'engine/migrations/apply.mjs')], { CLAUDE_PROJECT_DIR: root, CLAUDINITE_CAN_WITHHOLD_WORKFLOWS: '1' });
  // A note may have DECLARED a pack (the seed shape). The mount above was computed
  // from the declaration as it stood a moment ago, so the new pack's content is not
  // in it — and a declared pack whose code is absent is a BLOCKING config error until
  // something re-converges. Re-run the vendor pass when, and only when, the
  // declaration actually changed: it is whole-set convergence over a local tree, so
  // the cost is small and the result identical when nothing moved.
  if (readFileSync(checksPath, 'utf8') !== declarationBefore) {
    console.log('baselining: a migration note changed the declaration — re-converging the mount');
    node([join(tmp, 'vendoring/apply-vendor-set.mjs'), '--target', root, '--ref', headSha]);
  }

  // Ask about any declared secret the repo hasn't configured — but only once the
  // wiring is settled. On the cycle that FIRST stamps a name into the workflow the
  // value cannot be in this process's env yet, so asking then would nag about a
  // secret the owner may well have already added; next cycle tells the truth.
  const { declaredSecrets } = await import(pathToFileURL(join(tmp, 'engine/scheduler/converge-wiring.mjs')).href);
  const missingSecrets = wiringOut.includes('.github/workflows/claudinite-scheduler.yml')
    ? []
    : unconfiguredSecrets(await declaredSecrets(root, JSON.parse(readFileSync(checksPath, 'utf8'))), process.env);
  if (missingSecrets.length && await askForSecrets(token, repo, missingSecrets)) {
    console.log(`baselining: asked the owner to configure ${missingSecrets.join(', ')}`);
  }

  // 5. Pending agentic notes — selected BY VERSION, and no stamp hold (#768 Phase 4).
  //    A note is pending exactly while its record is still in this repo's gap, which
  //    is the same predicate vendoring fetches by and checks tolerate by. The date
  //    comparison it replaces needed the stamp HELD to keep a note selected, and that
  //    hold is what made `claudinite.updated` unreadable as freshness: a healthy repo
  //    with outstanding agentic work looked identical to a dead one, which is a
  //    mistake made about two live members on 2026-08-12 before the flip.
  //
  //    Version selection needs no hold: the record leaves the gap when the version
  //    that carries its change is installed, and nothing before then can deselect it.
  const { loadMigrations, agenticMigrations } = await import(pathToFileURL(join(tmp, 'engine/migrations/registry.mjs')).href);
  const { migrationApplies } = await import(pathToFileURL(join(tmp, 'engine/checks/helpers/active-migrations.mjs')).href);
  const pending = agenticMigrations(await loadMigrations())
    .filter((m) => migrationApplies(m.dir, { installed: priorStamp }))
    .sort((a, b) => String(a.landed).localeCompare(String(b.landed)));

  // 6. Meaningful change? A stamp-only bump against an unchanged head is not one —
  //    revert it and stay quiet (no nightly stamp-only noise).
  const changed = git(['-C', root, 'status', '--porcelain'])
    .split('\n').map((l) => l.slice(3)).filter(Boolean);
  // `materialize` excluded: a materialized delivery key also touches only
  // .claudinite-checks.json, and reverting it would re-drift the repo every night
  // and never land the repair.
  const onlyStamp = changed.length > 0 && !materialize && changed.every((p) => p === '.claudinite-checks.json');
  if (onlyStamp && priorStamp.ref === headSha && !pending.length) {
    git(['-C', root, 'checkout', '--', '.claudinite-checks.json']);
    console.log('baselining: mount already at canon head, nothing changed — agentless, quiet');
    return;
  }
  const meaningfulChange = changed.length > 0;
  // What this stage cannot push. Computed here, before the escalation gate, because a
  // withheld file is residual work for the agent exactly like a pending agentic note.
  const withheld = withheldWorkflowPaths(changed);
  if (withheld.length) {
    console.log(`baselining: withholding ${withheld.length} workflow file(s) from the push — `
      + `the Action token cannot write .github/workflows/; the agent stage lands them: ${withheld.join(', ')}`);
  }

  // 6b. SELF-TEST the converged tree before judging its content. This asks "can
  //     Claudinite still run here?" — mount, stamp, pack manifests, hook targets,
  //     mounted skills, cron, migrations registry — and it is the gate that would
  //     have caught #555 the night it landed: a required manifest field arrived
  //     with no migration, every consumer pack stopped validating, and because a
  //     pack that fails validation contributes NO rules, check_the_world went on
  //     reporting green about a corpus it was no longer running. A content check
  //     cannot see its own machinery break. This runs on the just-converged tree,
  //     so it judges what the member is about to live with.
  const selftest = runSelfTest(root);
  if (!selftest.ok) {
    console.log('baselining: the converged mount FAILED its self-test — requesting the agent');
    logGateOutput('selftest --strict', selftest);
  }

  // 7. Escalation gate: run the conformance checks only when a change happened and
  //    no agentic note already forces the agent. A failed self-test forces it too:
  //    broken machinery is exactly the judgment case, and merging it would spread
  //    the breakage to a repo that was working an hour ago.
  const checks = (meaningfulChange && !pending.length) ? runCheckTheWorld(root) : GATE_ABSENT;
  if (!checks.ok) logGateOutput('check_the_world', checks);
  const reason = escalation({
    pendingCount: pending.length, meaningfulChange, checksPass: checks.ok, selftestOk: selftest.ok,
    withheldCount: withheld.length, checksCrashed: checks.crashed, selftestCrashed: selftest.crashed,
  });
  const requestAgent = reason !== null;

  // 7b. A REHEARSAL stops here. It has done the only thing it was for — converged
  //     this real repo against a canon BRANCH and asked whether the result still
  //     works — and now it must leave no trace: no commit, no branch, no PR, and
  //     above all no stamp. Stamping a branch head would leave the member
  //     `ref-not-on-trunk`, which the #328 anti-rewind guard then refuses to
  //     converge over: a rehearsal that wedged the repo it was rehearsing on.
  //     `git checkout -- .` restores the working tree wholesale, so the mount goes
  //     back to the vendored snapshot the repo actually runs.
  if (source.rehearsal) {
    git(['-C', root, 'checkout', '--', '.']);
    const verdict = selftest.ok && checks.ok ? 'PASS' : 'FAIL';
    console.log(`baselining: rehearsal ${verdict} — selftest ${selftest.ok ? 'ok' : 'FAILED'}, `
      + `checks ${checks.ok ? 'green' : 'RED'}, ${changed.length} file(s) would have changed. Working tree restored.`);
    if (verdict === 'FAIL') process.exit(1);   // the canary's whole purpose: fail the canon PR
    return;
  }

  // 8. Deliver the converge (only when there's something to land).
  if (meaningfulChange || pending.length) {
    const seed = Math.random().toString(36).slice(2, 8);
    delivered = await deliver(root, repo, base, token, delivery, seed, withheld);
    console.log(`baselining: delivered converge on ${delivered.branch}${delivered.pr ? ` (PR #${delivered.pr}${delivered.merged ? ', merged' : ''})` : ''} (${delivery})`);
  } else {
    console.log('baselining: no change to deliver');
  }

  // 9. Request the agent only when judgment is left (conditional handoff, §3) — naming
  //    what this run created AND why the agent is being woken. `delivered` stays null
  //    when nothing was opened, and the issue then names nothing; `reason` is non-null
  //    exactly when the agent is requested at all.
  if (requestAgent && requestFile) {
    writeFileSync(requestFile, `${JSON.stringify({ marker: AGENT_REQUEST_MARKER, delivered, reason })}\n`);
  }
  console.log(requestAgent
    ? `baselining: requested agent stage (${reason.code}: ${reason.detail})`
    : 'baselining: agentless night — deterministic converge delivered, no agent needed');
}

// Run only when invoked directly (the scheduler's `node worker.mjs`), never on
// import — a test imports the pure helpers without any git or network.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`baselining preprocessing failed: ${e.message}`); process.exit(1); });
}
