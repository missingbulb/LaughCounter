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
//   4. apply the MECHANICAL migration notes (aliases/materialize/rewrite) via the
//      cloned migrations/apply.mjs — idempotent;
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
//      pushed branch, the held stamp, the pending note).
//
// Self-contained — imports only node builtins statically (the pack-independence
// barrier forbids reaching into the engine). The vendoring/migrations machinery
// is canon-internal (vendoring/ is never vendored, #385), so the worker INVOKES
// the freshly-fetched canon's scripts as subprocesses and DYNAMIC-imports its
// registry from the temp clone path — never a static import of engine code.
//
// This SUPERSEDES the per-cycle maintenance-branch naming of PR #407 (that PR
// reworked the OLD fleet-apply MCP path; baselining's delivery is native git
// Action-side and carries its own prefix/find-by-prefix here).

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const CANON_URL = 'https://github.com/missingbulb/Claudinite.git'; // public — no token
const MAINT_PREFIX = 'claudinite/maintenance';
const API = 'https://api.github.com';

// --- pure helpers (exported, unit-tested git-free) --------------------------

// The member's delivery preference, normalized. `push`/`auto` → auto-merge and
// `pr` → review are the permanent legacy aliases (same tolerance as fleet-apply);
// anything else is invalid (null) and fails the run rather than guessing.
export function normalizeDelivery(raw) {
  const v = String(raw ?? '').trim();
  if (v === 'auto-merge' || v === 'auto' || v === 'push') return 'auto-merge';
  if (v === 'review' || v === 'pr') return 'review';
  return null;
}

// The default a repo gets when it never declared one.
export const DEFAULT_DELIVERY = 'auto-merge';

// `maintenance.delivery` is always EXPLICIT — but a key that is simply absent is
// DRIFT, not an error, and drift is what a converge exists to repair. A repo
// adopted before the key existed, or one whose key was hand-removed, would
// otherwise fail baselining every night forever with nothing that could ever fix
// it (the only writer is check_the_world --init, which runs once at adoption).
// So: materialize the default into .claudinite-checks.json and carry on — it
// rides the same maintenance commit as the rest of the converge, and the repo
// self-heals on one cycle.
//
// An UNRECOGNIZED value is a different thing entirely: someone wrote an intent
// the worker cannot honour, and silently substituting a default would deliver
// the opposite of what they asked for. That still fails the run (delivery: null).
//
// Returns { delivery, materialize } — `delivery` null only for the unrecognized
// case. A content-free value (empty/whitespace) carries no intent, so it is
// treated as absent rather than as a typo.
export function resolveDelivery(raw) {
  if (raw == null || String(raw).trim() === '') {
    return { delivery: DEFAULT_DELIVERY, materialize: true };
  }
  return { delivery: normalizeDelivery(raw), materialize: false };
}

// The pending AGENTIC notes: those dated on/after the DAY of the prior stamp
// (same-day inclusive, #330), oldest first. `agenticList` is registry.mjs
// `agenticMigrations(all)` — already filtered to records carrying a valid
// `agentic` note (a malformed note throws THERE, aborting the run loudly).
export function pendingAgentic(agenticList, priorUpdated) {
  const priorDay = String(priorUpdated ?? '').slice(0, 10);
  return [...(agenticList ?? [])]
    .filter((m) => !priorDay || String(m.landed) >= priorDay)
    .sort((a, b) => String(a.landed).localeCompare(String(b.landed)));
}

// HOLD the stamp at the day before the earliest pending agentic note (the
// stamp/agentic coupling rule): the note stays selected next run until the agent
// lands it and advances the stamp itself. Returns the held ISO datetime, or null
// when nothing is pending (the stamp advances normally).
export function heldStamp(pending) {
  if (!pending?.length) return null;
  const d = new Date(`${String(pending[0].landed).slice(0, 10)}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString();
}

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

// --- CI dispatch on the maintenance PR (#565) --------------------------------
// The branch push and the PR open in deliver() both ride the Action's
// GITHUB_TOKEN, and GitHub suppresses workflow runs for events that token
// authors (its recursion guard) — so the maintenance PR gets NO pull_request
// run, auto-merge arms against a green that never arrives, and the PR sits open
// forever (#565; the canon-only variant was #432). The guard's one documented
// exception is workflow_dispatch: a dispatch POSTed with GITHUB_TOKEN does start
// a run, the run's check runs land on the branch-head sha, and that sha is what
// the PR's merge gate reads. So deliver() starts the PR's checks itself:
// dispatch every workflow that WOULD have run on pull_request and CAN be
// dispatched.
//
// "Suppresses" is only half true, and the other half is #455/#205/#95: on some
// members GitHub CREATES the pull_request run and parks it at `action_required`
// awaiting an approval nobody clicks. The dispatch above still supplies the real
// green, but the parked run is what auto-merge refuses over — which is why
// arming is not the end of the story and pullDisposition exists.
//
// Reading the triggers is a best-effort TEXTUAL scan of a workflow's top-level
// `on:` block (the worker is dependency-free — no YAML parser). It covers the
// shapes workflows actually use: a block map of trigger keys (with or without
// nested config), the inline scalar, and the inline list.
export function workflowTriggers(yaml) {
  const lines = String(yaml ?? '').split('\n');
  const onAt = lines.findIndex((l) => /^(['"]?)on\1\s*:/.test(l));
  if (onAt === -1) return [];
  const inline = lines[onAt].replace(/^(['"]?)on\1\s*:/, '').replace(/#.*$/, '').trim();
  if (inline) return inline.replace(/[[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
  const triggers = [];
  let childIndent = null;
  for (let i = onAt + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    if (indent === 0) break;                        // next top-level key — on: is done
    childIndent = childIndent ?? indent;            // first child fixes the trigger level
    if (indent !== childIndent) continue;           // nested config under a trigger
    const m = /^([A-Za-z_]+)\s*:/.exec(line.trim());
    if (m) triggers.push(m[1]);
  }
  return triggers;
}

// The dispatch plan over the repo's workflow files ({name, content} each):
// `dispatch` — runs on pull_request AND carries workflow_dispatch (start these);
// `missing`  — runs on pull_request but CANNOT be dispatched (name these in the
// log: adding `workflow_dispatch:` to that file's `on:` is the owner's one-line
// fix, and silence here would read as "no CI expected" when CI was expected).
// A workflow with no pull_request trigger is never touched — dispatchable-but-
// unrelated workflows (a release orchestrator, say) must not fire nightly.
export function ciDispatchPlan(files) {
  const dispatch = [];
  const missing = [];
  for (const { name, content } of files ?? []) {
    const triggers = workflowTriggers(content);
    if (!triggers.includes('pull_request')) continue;
    (triggers.includes('workflow_dispatch') ? dispatch : missing).push(name);
  }
  return { dispatch, missing };
}

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

// Why the PR-open POST must be status-checked, as a pure predicate: null when
// the PR was created, else the message to fail on.
//
// This is the one call whose silent failure is invisible AND self-perpetuating.
// `openMaintenancePull` finds only an OPEN PR, so a cycle that pushes its branch
// but fails to open the PR leaves nothing for the next cycle to dispose of, and
// the next — branches pile up nightly, the stamp never advances, and the run still reports `ok`
// because nothing read the status. The fleet ran exactly that way for two days:
// every consumer but the pilot sat on the same canon ref carrying 07-29 and
// 07-30 maintenance branches with no PR behind either.
//
// The usual cause is repo-level and invisible from here — "Allow GitHub Actions
// to create and approve pull requests" is off and the POST 403s — so the message
// names that remedy rather than leaving a bare status code.
export function pullCreateError(status, json) {
  if (status === 201 && json?.number) return null;
  const detail = json?.message ?? `HTTP ${status}`;
  return `${detail} — if this is the Actions PR permission, enable Settings → Actions`
    + ' → General → "Allow GitHub Actions to create and approve pull requests"';
}

// How an `auto-merge` member's PR actually lands, given whether this repo has any
// pull_request-triggered workflow at all.
//
// GitHub's auto-merge is a QUEUE FOR CHECKS. On a repo with no PR CI there is
// nothing to queue behind: the mutation is rejected ("Pull request is in clean
// status"), and since the failure was swallowed the PR sat open forever — the
// stamp never advanced, the next cycle reused the same PR, and a repo that asked
// for `auto-merge` got no merge at all. Seven of twelve consumers are in exactly
// that shape (no `pull_request` trigger anywhere in .github/workflows).
//
// So: no CI to wait for → MERGE IT, which is what `auto-merge` meant all along.
// CI present → arm, and let the checks gate it as designed.
//
// `hasPrCi` comes from ciDispatchPlan over the branch's own workflow files —
// `dispatch` (startable) plus `missing` (PR-triggered but not dispatchable). Both
// empty means no workflow anywhere runs on a pull_request, so no check will ever
// appear. That is a fact about the tree, not a race against checks registering.
//
// `gate` is what the BASE BRANCH requires (classifyMergeGate) — the thing
// GitHub's auto-merge actually queues behind. CI existing was the wrong
// predicate (#677): on an unprotected base the PR is mergeable the whole time
// its checks run, so `enablePullRequestAutoMerge` is rejected "clean status"
// every cycle no matter how green — arming there is doomed, and the delivery
// goes straight to verify-then-land instead. `unknown` arms: a gate we could
// not see is never merged past.
export function deliveryAction({ delivery, hasPrCi, gate = 'unknown' }) {
  if (delivery !== 'auto-merge') return 'none';
  if (!hasPrCi) return 'merge';
  return gate === 'absent' ? 'land' : 'arm';
}

// What the base branch requires before a merge, from the two reads the Action's
// GITHUB_TOKEN can make: the branch's `protected` flag and the ruleset rules
// that apply to it (deliberately NOT /branches/{base}/protection, which wants
// admin). Rule types that queue a PR gate it; rules about pushes and deletions
// do not. An unreadable answer is UNKNOWN, never absent — unknown assumes a
// gate, so the caller arms rather than merging past a gate it cannot see.
const GATING_RULE_TYPES = ['pull_request', 'required_status_checks', 'merge_queue', 'required_deployments'];
export function classifyMergeGate({ branchStatus, branchJson, rulesStatus, rulesJson }) {
  if (branchStatus !== 200 || typeof branchJson?.protected !== 'boolean') return 'unknown';
  if (branchJson.protected) return 'present';
  if (rulesStatus !== 200 || !Array.isArray(rulesJson)) return 'unknown';
  return rulesJson.some((r) => GATING_RULE_TYPES.includes(r?.type)) ? 'present' : 'absent';
}

async function readMergeGate(token, repo, base) {
  const branch = await gh(token, `/repos/${repo}/branches/${encodeURIComponent(base)}`);
  const rules = await gh(token, `/repos/${repo}/rules/branches/${encodeURIComponent(base)}`);
  return classifyMergeGate({
    branchStatus: branch.status, branchJson: branch.json,
    rulesStatus: rules.status, rulesJson: rules.json,
  });
}

// --- Landing a PR the arm could not land (#455/#205/#95) ---------------------
// Arming is best-effort and can fail PERMANENTLY, so "arm and move on" is not a
// delivery guarantee. Two shapes, both observed across the fleet, both leaving a
// green PR open forever:
//
//   1. GATED CI. The block above assumes GitHub SUPPRESSES the pull_request run
//      for a GITHUB_TOKEN push. On several members it does not — it CREATES the
//      run and parks it at conclusion `action_required`, pending a human
//      "Approve and run" that nobody is watching for. The run never executes, so
//      it never reports; `enablePullRequestAutoMerge` then refuses the PR with
//      "in unstable status (required checks are failing)". Meanwhile the
//      workflow_dispatch run deliver() started on the SAME head sha ran and
//      passed. So CI did pass; only the phantom gated run says otherwise.
//   2. AUTO-MERGE OFF. The repo never enabled Settings → General → "Allow
//      auto-merge", so the mutation is rejected outright no matter how green.
//
// Both are settled by the same evidence, read from the runs on the PR's own head
// sha a cycle later: if CI has CONCLUDED and nothing actually failed, the content
// on that sha is verified and `auto-merge` means merge it. A gated
// `action_required` run is not a failure — it is a run that never happened.
//
// Deliberately conservative about MERGING, because that bypasses the arm:
//   - Anything still queued/running → `wait`. Never merge mid-flight, and never
//     bin a cycle whose checks might still land it.
//   - Any real failure (failure / timed_out / cancelled / startup_failure), or no
//     successful run to stand on → `close`. NOT a merge, and equally not a reuse.
//
// `close` is the other half of the fix, and the more important one. Reusing the
// open PR — force-pushing each cycle's converge onto whatever state it had
// accumulated — is what made a single failed arm permanent: the PR outlived every
// cycle, so one bad night was inherited forever. Baselining is a DETERMINISTIC,
// IDEMPOTENT converge; the previous attempt carries no information this one needs.
// So a PR that did not land gets closed and re-cut from scratch, and no PR ever
// survives more than one cycle. Pile-up is prevented by closing the old one in the
// same step that mints the new, not by reusing it.
//
// A `review` member's PR is the owner's to act on, on their own clock — never
// merged, and never closed out from under them either.
export const REAL_FAILURES = ['failure', 'timed_out', 'cancelled', 'startup_failure'];

export function pullDisposition({ delivery, runs }) {
  if (delivery !== 'auto-merge') return 'keep';
  const list = (runs ?? []).filter(Boolean);
  if (list.some((r) => r.status !== 'completed')) return 'wait';
  if (list.some((r) => REAL_FAILURES.includes(r.conclusion))) return 'close';
  if (!list.some((r) => r.conclusion === 'success')) return 'close';
  return 'merge';
}

// Why the merge had to happen here rather than through the arm. The log line has
// to name which shape this was, or the repo misconfiguration behind it stays
// invisible — and it is a REPO setting, so only a human can retire it.
export function mergeReason(runs) {
  // The no-remedy shape names no setting (#677): on a base that requires
  // nothing, landing here IS the design, and sending an owner to fix something
  // already correct is worse than saying nothing.
  return (runs ?? []).some((r) => r?.conclusion === 'action_required')
    ? 'its pull_request run is parked at action_required (never ran) while the dispatched run passed'
    + ' — check Settings → Actions → General → workflow-approval requirements'
    : 'its dispatched checks concluded green and nothing on the base branch queues an auto-merge';
}

// Why a PR was closed rather than merged — the same visibility argument, for the
// case that matters more: a member whose CI is genuinely red.
export function failureSummary(runs) {
  const failed = (runs ?? []).filter((r) => REAL_FAILURES.includes(r?.conclusion));
  if (failed.length) return `failing CI: ${failed.map((r) => `${r.name} ${r.conclusion}`).join(', ')}`;
  return 'no successful run on its head sha';
}

// --- landing THIS cycle's PR when the arm could not (#649) --------------------
// The disposal above is correct and a full day late. On a member whose
// pull_request run is gated, EVERY cycle's arm fails, so every converge waits for
// the next cycle to land it — a standing ~24h offset between canon and that
// member's main, which reads as a mount that is permanently stale.
//
// The evidence that settles it does not take a day to arrive: the dispatched run
// this cycle just started finishes in seconds. So we wait for it, once, and merge
// on exactly the reasoning disposal uses. Same decision, made now.
//
// Bounded and cheap because it only runs where the arm ALREADY failed: a healthy
// member arms and returns without waiting at all. The bound is well inside
// `prework_timeout` (900s), and hitting it costs nothing — the PR is
// simply left for the next cycle, exactly as before this existed.
export const LAND_TIMEOUT_MS = 180_000;
export const LAND_POLL_MS = 5_000;

// What one poll of the head sha's runs says to do: `merge`, `poll` again, or
// `give-up` and leave the PR standing.
//
// It NEVER closes. Disposal may close a PR because that PR is last cycle's and
// this cycle is about to re-cut it; here the PR IS this cycle's delivery, and
// closing it would throw away the converge that just ran. A red member therefore
// leaves its PR open for the next cycle to dispose of properly — the behaviour
// that existed before this, reached deliberately rather than by omission.
// `expected` is how many verification runs THIS worker dispatched on the head
// seconds ago. Fewer visible runs than that is the API still registering them —
// a POLL, never a verdict. Without it, the first read 0.3s after the dispatch
// found an empty list and judged "nothing will ever verify this", stranding
// seven members' green PRs in one forced fleet pass (2026-08-07).
export function landAttempt({ delivery, runs, expected = 0, elapsedMs = 0, timeoutMs = LAND_TIMEOUT_MS }) {
  if ((runs ?? []).length < expected) return elapsedMs >= timeoutMs ? 'give-up' : 'poll';
  const disposition = pullDisposition({ delivery, runs });
  if (disposition === 'merge') return 'merge';
  if (disposition === 'wait') return elapsedMs >= timeoutMs ? 'give-up' : 'poll';
  return 'give-up';
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

  // ARM GitHub's native auto-merge (not an immediate merge): the PR lands
  // automatically once this repo's required checks pass, and the run never blocks
  // on CI. Auto-merge is a GraphQL-only mutation.
  //
  // Every cycle opens its own PR and arms it, so the arm is never stale — and it
  // is no longer the only thing standing between a converge and `main`: the arm
  // failing (auto-merge off, or a gated pull_request run) now costs one cycle,
  // not forever, because the next cycle merges this PR on its concluded runs
  // (pullDisposition) or closes it and re-cuts. Idempotent either way.
  // Start the PR's checks FIRST — the GITHUB_TOKEN push/open above emitted no
  // pull_request event, so without this the PR has no runs (#565, the
  // ciDispatchPlan block). AFTER the push, so the dispatched runs execute the
  // branch's own head; every delivering cycle, since a force-push emits no
  // synchronize event either and each new head needs its own runs. Best-effort:
  // a dispatch failure must not fail the converge that was already pushed.
  //
  // It runs BEFORE the delivery decision because it is what establishes whether
  // this repo has any PR CI at all — the fact deliveryAction turns on.
  const ci = await dispatchCiRuns(token, repo, branch)
    .catch((e) => { console.log(`baselining: CI dispatch on ${branch} failed: ${e.message}`); return null; });
  const hasPrCi = ci ? ci.dispatch.length + ci.missing.length > 0 : true; // unknown → assume CI, never merge blind
  // How many verification runs THIS cycle just started on the head — what the
  // landing poll waits to see registered before it judges anything (landAttempt).
  const expected = ci?.dispatch.length ?? 0;

  if (pr?.number) {
    const gate = pr ? await readMergeGate(token, repo, base).catch(() => 'unknown') : 'unknown';
    const action = deliveryAction({ delivery, hasPrCi, gate });
    if (action === 'merge') {
      const res = await gh(token, `/repos/${repo}/pulls/${pr.number}/merge`, {
        method: 'PUT', body: { merge_method: 'squash' },
      });
      if (res.status === 200) { merged = true; console.log(`baselining: merged PR #${pr.number} directly — this repo has no pull_request CI to gate on`); }
      else console.log(`baselining: could not merge PR #${pr.number} (${res.status}: ${res.json?.message ?? 'no message'})`);
    } else if (action === 'land') {
      // The base requires nothing, so auto-merge has no queue to wait behind and
      // the arm mutation would be rejected "clean status" — every cycle, no
      // setting to fix (#677). Skip the doomed arm; wait for this cycle's own
      // dispatched evidence and land on it, the same reasoning disposal uses a
      // day later. Delivery must land every cycle, not heal next cycle.
      console.log(`baselining: ${base} requires nothing to merge — skipping the doomed auto-merge arm;`
        + ` waiting for this cycle's ${expected} dispatched run(s) and landing PR #${pr.number} here`);
      if (await landNow(token, repo, pr, delivery, expected)) merged = true;
    } else if (action === 'arm' && pr.node_id) {
      // Surfaced, not swallowed: a failed arm is why a maintenance PR sits open
      // forever, and the two usual causes are both fixable repo settings.
      const armed = await enableAutoMerge(token, pr.node_id).then(() => true)
        .catch((e) => {
          console.log(`baselining: could not arm auto-merge on PR #${pr.number}: ${e.message}`
            + ' — check Settings → General → "Allow auto-merge", and Settings → Actions → General for a'
            + ' workflow-approval requirement parking this PR\'s pull_request run at action_required.'
            + ' Waiting for this cycle\'s dispatched run and landing it here.');
          return false;
        });
      // Only where the arm failed. A member that armed is GitHub's to land, and
      // waiting on it here would add a poll to every healthy repo for nothing.
      if (!armed && await landNow(token, repo, pr, delivery, expected)) merged = true;
    }
  }
  // What this cycle delivered. The scheduler records it in the dispatch issue, which is
  // the agent's source for these artifacts.
  return { branch, pr: pr?.number ?? null, merged };
}

// The I/O half of same-cycle landing: poll this PR's head sha until its runs have
// concluded, then merge on the same evidence disposal would use a day later.
// Returns true iff it merged. Best-effort throughout — every failure path leaves
// the PR exactly as the arm left it, which is what the next cycle expects.
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function landNow(token, repo, pr, delivery, expected = 0) {
  const started = Date.now();
  for (;;) {
    const { status, json } = await gh(token, `/repos/${repo}/actions/runs?head_sha=${pr.head?.sha ?? ''}&per_page=100`);
    if (status !== 200) {
      console.log(`baselining: could not read this cycle's runs for PR #${pr.number} (HTTP ${status}) — leaving it for the next cycle`);
      return false;
    }
    const runs = (json?.workflow_runs ?? []).map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion }));
    const attempt = landAttempt({ delivery, runs, expected, elapsedMs: Date.now() - started });

    if (attempt === 'poll') { await sleep(LAND_POLL_MS); continue; }
    if (attempt === 'give-up') {
      console.log(`baselining: PR #${pr.number} not landable this cycle (${failureSummary(runs)})`
        + ' — leaving it open for the next cycle to dispose of');
      return false;
    }

    const res = await gh(token, `/repos/${repo}/pulls/${pr.number}/merge`, {
      method: 'PUT', body: { merge_method: 'squash' },
    });
    if (res.status === 200) {
      console.log(`baselining: merged PR #${pr.number} in-cycle — ${mergeReason(runs)}`);
      await deleteBranch(token, repo, pr.head?.ref);
      return true;
    }
    console.log(`baselining: could not merge PR #${pr.number} (${res.status}: ${res.json?.message ?? 'no message'})`
      + ' — leaving it for the next cycle');
    return false;
  }
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
      await deleteBranch(token, repo, pr.head?.ref);
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
  await deleteBranch(token, repo, pr.head?.ref);
  return null;
}

// Tidy the ref behind a disposed PR — a closed branch left on the remote is litter
// that accumulates one per cycle. Never fatal: the branch is not the deliverable.
async function deleteBranch(token, repo, ref) {
  if (!ref) return;
  const res = await gh(token, `/repos/${repo}/git/refs/heads/${encodeURIComponent(ref)}`, { method: 'DELETE' });
  if (res.status !== 204) console.log(`baselining: could not delete branch ${ref} (HTTP ${res.status})`);
}

// The I/O half of the CI dispatch (#565): read the workflow files as they exist
// ON THE MAINTENANCE BRANCH (the converge may itself have changed them), plan
// with ciDispatchPlan, POST a dispatch per selected workflow, and log every
// outcome — a silent no-checks PR is exactly the failure mode this exists to
// close. Needs the scheduler workflow's `actions: write` (a read-only token
// 403s the POST silently — the store-release lesson).
async function dispatchCiRuns(token, repo, branch) {
  const ref = encodeURIComponent(branch);
  const { json: dir } = await gh(token, `/repos/${repo}/contents/.github/workflows?ref=${ref}`);
  const files = [];
  for (const entry of Array.isArray(dir) ? dir : []) {
    if (!/\.ya?ml$/.test(entry.name ?? '')) continue;
    const { json } = await gh(token, `/repos/${repo}/contents/.github/workflows/${entry.name}?ref=${ref}`);
    files.push({ name: entry.name, content: json?.content ? Buffer.from(json.content, 'base64').toString('utf8') : '' });
  }
  const { dispatch, missing } = ciDispatchPlan(files);
  for (const name of missing) {
    console.log(`baselining: ${name} runs on pull_request but has no workflow_dispatch trigger — `
      + 'cannot start it on the maintenance PR; add `workflow_dispatch:` under its `on:` to let baselining run it');
  }
  if (!dispatch.length && !missing.length) {
    console.log('baselining: no pull_request-triggered workflow — the maintenance PR has no checks to wait for');
  }
  for (const name of dispatch) {
    const res = await gh(token, `/repos/${repo}/actions/workflows/${name}/dispatches`, {
      method: 'POST', body: { ref: branch },
    });
    if (res.status === 204) console.log(`baselining: dispatched ${name} on ${branch} — the maintenance PR gets its checks`);
    else console.log(`baselining: could not dispatch ${name} on ${branch} (${res.status})`);
  }
  return { dispatch, missing };
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

// Arm native auto-merge on a PR (by node id) via the GraphQL mutation — the REST
// `PUT /merge` would merge NOW, ignoring pending checks; this waits for them.
async function enableAutoMerge(token, pullRequestId) {
  const query = 'mutation($id:ID!){enablePullRequestAutoMerge(input:{pullRequestId:$id,mergeMethod:SQUASH}){pullRequest{id}}}';
  const res = await fetch(`${API}/graphql`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: { id: pullRequestId } }),
  });
  const json = await res.json().catch(() => null);
  if (json?.errors?.length) throw new Error(json.errors[0].message);
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
  // The handshake (migrations/registry.mjs, WITHHOLD_CAPABLE_ENV): THIS worker withholds
  // workflow paths from its commit and hands them to the agent, so a record may safely
  // materialize one. An older vendored worker does not set it and the materialization is
  // skipped instead of wedging its push. Set here, by the code that does the withholding,
  // because the question is what the RUNNING process can do — and the disk cannot answer
  // it: apply-vendor-set above has already overwritten this very file with the new
  // version while this old-or-new code is the thing actually executing.
  node([join(tmp, 'migrations/apply.mjs')], { CLAUDE_PROJECT_DIR: root, CLAUDINITE_CAN_WITHHOLD_WORKFLOWS: '1' });

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

  // 5. Pending agentic notes (from the fresh canon clone) + stamp hold.
  const { loadMigrations, agenticMigrations } = await import(pathToFileURL(join(tmp, 'migrations/registry.mjs')).href);
  const pending = pendingAgentic(agenticMigrations(await loadMigrations()), priorStamp.updated);
  if (pending.length) {
    const raw = JSON.parse(readFileSync(checksPath, 'utf8'));
    raw.claudinite = { ...raw.claudinite, updated: heldStamp(pending) };
    writeFileSync(checksPath, JSON.stringify(raw, null, 2) + '\n');
  }

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
