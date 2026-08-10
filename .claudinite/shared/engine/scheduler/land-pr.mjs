// Land a task's delivered pull request under the REPO's delivery settings — the
// single home for the auto-merge nuances every PR-delivering task shares. These
// helpers were built inside the baselining worker (#455/#565/#649/#677/#690);
// they live here because the other `merged-pr` tasks hit the identical failure
// shapes (an arm rejected "clean status" on an ungated base stranding a green PR
// forever), and two copies of this precedence is exactly the drift the corpus
// forbids.
//
// The contract that keeps tasks simple: a task declares only its outcome CEILING
// (`expected_outcome: 'merged-pr'` — it MAY land a PR). Whether the PR actually
// lands unreviewed is the MEMBER REPO's call — `maintenance.delivery` in
// `.claudinite-checks.json`, where `review` degrades every merged-pr task to
// open-pr (member config wins, per-project-scheduling DESIGN §1). Tasks stay
// unaware of that setting by construction: they hand their PR to landDelivery()
// (directly, or through deliver-generated.mjs) and the repo-shape nuances stay
// here:
//
//   - `review` member          → the PR is opened and LEFT — never armed, never merged.
//   - no pull_request CI at all → MERGE directly. GitHub's auto-merge is a queue
//     for checks; with nothing to queue behind, the arm is rejected ("Pull
//     request is in clean status") every time, and while that rejection was
//     swallowed a repo that asked for auto-merge got no merge at all.
//   - CI present, but the base branch REQUIRES nothing → the arm is equally
//     doomed (same clean-status rejection, #677): skip it, wait for this run's
//     own dispatched evidence, and land on it (verify-then-merge).
//   - a base gate present — or unreadable, which is never read as absent → ARM,
//     with the landing poll as fallback when the arm is rejected (auto-merge
//     disabled repo-side, or a pull_request run parked at `action_required`).
//
// A branch pushed and a PR opened over the Action's GITHUB_TOKEN emit no
// pull_request run of their own (GitHub's recursion guard, #565), so
// landDelivery also STARTS the PR's checks via workflow_dispatch before deciding
// anything — the checks an arm would wait on must exist to conclude.
//
// The AGENT lane (executor subagents, MCP writes) cannot run this module; its
// prose twin is `deliver-pr.md` beside this file, and the two must keep saying
// the same thing — a nuance changed here changes there in the same commit.
// (baselining's worker consumes this module for the same reason its sibling
// tasks do; its family-branch disposal — close-and-recut — stays in the worker,
// because no other task re-cuts a per-cycle branch.)

const API = 'https://api.github.com';

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

// --- the member's delivery preference ----------------------------------------

// The member's delivery preference, normalized. `push`/`auto` → auto-merge and
// `pr` → review are the permanent legacy aliases (the maintenance-lane tolerance);
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
// DRIFT, not an error. A repo adopted before the key existed, or one whose key
// was hand-removed, would otherwise fail its scheduled tasks every night forever
// with nothing that could ever fix it (the only writer is check_the_world --init,
// which runs once at adoption; baselining's converge is what repairs the drift).
// So: resolve to the default and carry on — `materialize: true` tells the one
// caller that CAN write the repair (baselining) to do so; everyone else just uses
// the resolved value.
//
// An UNRECOGNIZED value is a different thing entirely: someone wrote an intent
// this code cannot honour, and silently substituting a default would deliver
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

// The same resolution, from the raw TEXT of a repo's .claudinite-checks.json —
// the shape a caller reading the file off a git blob has in hand. Unparsable or
// absent text resolves like a missing key: default, not failure (the file's
// integrity is check_the_world's problem, not the delivery step's).
export function deliveryFromChecks(text) {
  let parsed = null;
  try { parsed = JSON.parse(text ?? 'null'); } catch { /* unreadable → absent */ }
  return resolveDelivery(parsed?.maintenance?.delivery);
}

// --- CI dispatch on the delivered PR (#565) -----------------------------------
// The GITHUB_TOKEN push/PR-open emits no pull_request run (GitHub's recursion
// guard), so the delivery starts the PR's checks itself: dispatch every workflow
// that WOULD have run on pull_request and CAN be dispatched.
//
// "Suppresses" is only half true, and the other half is #455/#205/#95: on some
// members GitHub CREATES the pull_request run and parks it at `action_required`
// awaiting an approval nobody clicks. The dispatch above still supplies the real
// green, but the parked run is what auto-merge refuses over — which is why
// arming is not the end of the story and pullDisposition exists.
//
// Reading the triggers is a best-effort TEXTUAL scan of a workflow's top-level
// `on:` block (no YAML parser in the corpus). It covers the shapes workflows
// actually use: a block map of trigger keys (with or without nested config), the
// inline scalar, and the inline list.
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
// unrelated workflows (a release orchestrator, say) must not fire on a delivery.
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

// The I/O half of the CI dispatch: read the workflow files as they exist ON THE
// DELIVERED BRANCH (the delivery may itself have changed them), plan with
// ciDispatchPlan, POST a dispatch per selected workflow, and log every outcome —
// a silent no-checks PR is exactly the failure mode this exists to close. Needs
// the scheduler workflow's `actions: write` (a read-only token 403s the POST
// silently — the store-release lesson).
// Returns { dispatch, missing, started }: `dispatch`/`missing` are the PLAN
// (what the tree says should run), `started` the dispatches GitHub actually
// accepted (204). The landing poll must wait only on `started` — a POST that
// 403'd (the scheduler workflow missing `actions: write`, the canon's own copy
// on 2026-08-08) starts nothing, and counting the plan had the poll waiting for
// a run that could never come.
export async function dispatchCiRuns({ token, repo, branch, log = console.log }) {
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
    log(`${name} runs on pull_request but has no workflow_dispatch trigger — `
      + 'cannot start it on the delivered PR; add `workflow_dispatch:` under its `on:` to let the delivery run it');
  }
  if (!dispatch.length && !missing.length) {
    log('no pull_request-triggered workflow — the delivered PR has no checks to wait for');
  }
  const started = [];
  for (const name of dispatch) {
    const res = await gh(token, `/repos/${repo}/actions/workflows/${name}/dispatches`, {
      method: 'POST', body: { ref: branch },
    });
    if (res.status === 204) { started.push(name); log(`dispatched ${name} on ${branch} — the delivered PR gets its checks`); }
    else {
      log(`could not dispatch ${name} on ${branch} (${res.status})`
        + (res.status === 403 ? ' — the scheduler workflow needs `actions: write` (a read token 403s this POST silently)' : ''));
    }
  }
  return { dispatch, missing, started };
}

// --- opening the PR ------------------------------------------------------------

// Why the PR-open POST must be status-checked, as a pure predicate: null when
// the PR was created, else the message to fail on.
//
// This is the one call whose silent failure is invisible AND self-perpetuating:
// a cycle that pushes its branch but fails to open the PR leaves nothing for the
// next cycle to find, branches pile up nightly, and the run still reports `ok`
// because nothing read the status. The usual cause is repo-level and invisible
// from here — "Allow GitHub Actions to create and approve pull requests" is off
// and the POST 403s — so the message names that remedy rather than leaving a
// bare status code.
export function pullCreateError(status, json) {
  if (status === 201 && json?.number) return null;
  const detail = json?.message ?? `HTTP ${status}`;
  return `${detail} — if this is the Actions PR permission, enable Settings → Actions`
    + ' → General → "Allow GitHub Actions to create and approve pull requests"';
}

// --- the delivery decision -------------------------------------------------------

// How an `auto-merge` member's PR actually lands, given whether this repo has any
// pull_request-triggered workflow at all.
//
// GitHub's auto-merge is a QUEUE FOR CHECKS. On a repo with no PR CI there is
// nothing to queue behind: the mutation is rejected ("Pull request is in clean
// status"), and since the failure was swallowed the PR sat open forever — a repo
// that asked for `auto-merge` got no merge at all. Seven of twelve consumers were
// in exactly that shape (no `pull_request` trigger anywhere in .github/workflows).
//
// So: no CI to wait for → MERGE IT, which is what `auto-merge` meant all along.
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

export async function readMergeGate(token, repo, base) {
  const branch = await gh(token, `/repos/${repo}/branches/${encodeURIComponent(base)}`);
  const rules = await gh(token, `/repos/${repo}/rules/branches/${encodeURIComponent(base)}`);
  return classifyMergeGate({
    branchStatus: branch.status, branchJson: branch.json,
    rulesStatus: rules.status, rulesJson: rules.json,
  });
}

// --- judging a PR by the runs on its head (#455/#205/#95) ---------------------
// Arming is best-effort and can fail PERMANENTLY, so "arm and move on" is not a
// delivery guarantee. Two shapes, both observed across the fleet, both leaving a
// green PR open forever:
//
//   1. GATED CI. GitHub CREATES the pull_request run for a GITHUB_TOKEN push and
//      parks it at conclusion `action_required`, pending a human "Approve and
//      run" that nobody is watching for. The run never executes, so it never
//      reports; `enablePullRequestAutoMerge` then refuses the PR with "in
//      unstable status (required checks are failing)". Meanwhile the
//      workflow_dispatch run started on the SAME head sha ran and passed. So CI
//      did pass; only the phantom gated run says otherwise.
//   2. AUTO-MERGE OFF. The repo never enabled Settings → General → "Allow
//      auto-merge", so the mutation is rejected outright no matter how green.
//
// Both are settled by the same evidence: the runs on the PR's own head sha. If
// CI has CONCLUDED and nothing actually failed, the content on that sha is
// verified and `auto-merge` means merge it. A gated `action_required` run is not
// a failure — it is a run that never happened.
//
// Deliberately conservative about MERGING, because that bypasses the arm:
//   - Anything still queued/running → `wait`. Never merge mid-flight.
//   - Any real failure (failure / timed_out / cancelled / startup_failure), or no
//     successful run to stand on → `close`: NOT a merge, and equally not a reuse.
//     (What `close` means is the CALLER's policy — baselining closes and re-cuts
//     its per-cycle branch; a landing pass just leaves the PR standing.)
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

// Why a PR was left (or closed) rather than merged — the same visibility
// argument, for the case that matters more: a member whose CI is genuinely red.
export function failureSummary(runs) {
  const failed = (runs ?? []).filter((r) => REAL_FAILURES.includes(r?.conclusion));
  if (failed.length) return `failing CI: ${failed.map((r) => `${r.name} ${r.conclusion}`).join(', ')}`;
  return 'no successful run on its head sha';
}

// --- landing THIS run's PR when the arm could not (#649) ----------------------
// On a member whose pull_request run is gated, EVERY arm fails; deferring to the
// next cycle's disposal put a standing ~24h offset between a task's output and
// that member's main. The evidence that settles it does not take a day to
// arrive: the dispatched run this delivery just started finishes in seconds. So
// we wait for it, once, and merge on exactly the reasoning disposal uses. Same
// decision, made now.
//
// Bounded and cheap because it only runs where the arm ALREADY failed (or was
// skipped as doomed): a healthy member arms and returns without waiting at all.
export const LAND_TIMEOUT_MS = 180_000;
export const LAND_POLL_MS = 5_000;

// What one poll of the head sha's runs says to do: `merge`, `poll` again, or
// `give-up` and leave the PR standing.
//
// It NEVER closes. A cycle's disposal may close a PR because that PR is LAST
// cycle's and this cycle is about to re-cut it; here the PR IS this run's
// delivery, and closing it would throw away the work that just ran. A red member
// therefore leaves its PR open for the next run (or a human) to dispose of.
// `expected` is how many verification runs THIS delivery dispatched on the head
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

// Arm native auto-merge on a PR (by node id) via the GraphQL mutation — the REST
// `PUT /merge` would merge NOW, ignoring pending checks; this waits for them.
export async function enableAutoMerge(token, pullRequestId) {
  const query = 'mutation($id:ID!){enablePullRequestAutoMerge(input:{pullRequestId:$id,mergeMethod:SQUASH}){pullRequest{id}}}';
  const res = await fetch(`${API}/graphql`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: { id: pullRequestId } }),
  });
  const json = await res.json().catch(() => null);
  if (json?.errors?.length) throw new Error(json.errors[0].message);
}

// Tidy the ref behind a merged (or disposed) PR — a dead branch left on the
// remote is litter that accumulates one per run. Never fatal: the branch is not
// the deliverable.
export async function deleteBranch({ token, repo, ref, log = console.log }) {
  if (!ref) return;
  const res = await gh(token, `/repos/${repo}/git/refs/heads/${encodeURIComponent(ref)}`, { method: 'DELETE' });
  if (res.status !== 204) log(`could not delete branch ${ref} (HTTP ${res.status})`);
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// The I/O half of same-run landing: poll this PR's head sha until its runs have
// concluded, then merge on the same evidence disposal would use a cycle later.
// Returns true iff it merged. Best-effort throughout — every failure path leaves
// the PR exactly as the arm left it, which is what the next run expects.
export async function landNow({ token, repo, pr, delivery, expected = 0, log = console.log }) {
  const started = Date.now();
  for (;;) {
    const { status, json } = await gh(token, `/repos/${repo}/actions/runs?head_sha=${pr.head?.sha ?? ''}&per_page=100`);
    if (status !== 200) {
      log(`could not read this run's checks for PR #${pr.number} (HTTP ${status}) — leaving it for the next run`);
      return false;
    }
    const runs = (json?.workflow_runs ?? []).map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion }));
    const attempt = landAttempt({ delivery, runs, expected, elapsedMs: Date.now() - started });

    if (attempt === 'poll') { await sleep(LAND_POLL_MS); continue; }
    if (attempt === 'give-up') {
      log(`PR #${pr.number} not landable this run (${failureSummary(runs)})`
        + ' — leaving it open for the next run to dispose of');
      return false;
    }

    const res = await gh(token, `/repos/${repo}/pulls/${pr.number}/merge`, {
      method: 'PUT', body: { merge_method: 'squash' },
    });
    if (res.status === 200) {
      log(`merged PR #${pr.number} in-cycle — ${mergeReason(runs)}`);
      await deleteBranch({ token, repo, ref: pr.head?.ref, log });
      return true;
    }
    log(`could not merge PR #${pr.number} (${res.status}: ${res.json?.message ?? 'no message'})`
      + ' — leaving it for the next run');
    return false;
  }
}

// The whole landing, composed — what a task's delivery calls once its PR exists.
// Dispatch the PR's checks (they establish `hasPrCi`, the fact deliveryAction
// turns on), read what the base requires, then merge / land / arm per the
// decision — with the landing poll as fallback for a failed arm. `pr` must carry
// the CURRENT head ({ number, node_id, head: { ref, sha } }): after a force-push,
// a stale sha polls runs that will never conclude.
//
// Returns { merged, action }. `action: 'none'` is the review member — the PR
// stands, deliberately, and that is a delivered outcome, not a failure.
export async function landDelivery({ token, repo, base, pr, delivery, log = console.log }) {
  // Start the PR's checks FIRST — the GITHUB_TOKEN push/open emitted no
  // pull_request event, so without this the PR has no runs (#565). AFTER the
  // push, so the dispatched runs execute the branch's own head. Best-effort: a
  // dispatch failure must not fail the delivery that was already pushed. Run for
  // review members too — their owner wants green checks to review against.
  const ci = await dispatchCiRuns({ token, repo, branch: pr.head?.ref, log })
    .catch((e) => { log(`CI dispatch on ${pr.head?.ref} failed: ${e.message}`); return null; });
  const hasPrCi = ci ? ci.dispatch.length + ci.missing.length > 0 : true; // unknown → assume CI, never merge blind
  // How many verification runs this delivery ACTUALLY started on the head — what
  // the landing poll waits to see registered before it judges anything
  // (landAttempt). `started`, never the plan: a rejected dispatch POST starts
  // nothing, and waiting on the plan wedges the poll against a run that can
  // never come.
  const expected = ci?.started?.length ?? 0;

  const gate = await readMergeGate(token, repo, base).catch(() => 'unknown');
  const action = deliveryAction({ delivery, hasPrCi, gate });
  let merged = false;

  if (action === 'merge') {
    const res = await gh(token, `/repos/${repo}/pulls/${pr.number}/merge`, {
      method: 'PUT', body: { merge_method: 'squash' },
    });
    if (res.status === 200) { merged = true; log(`merged PR #${pr.number} directly — this repo has no pull_request CI to gate on`); }
    else log(`could not merge PR #${pr.number} (${res.status}: ${res.json?.message ?? 'no message'})`);
  } else if (action === 'land') {
    // The base requires nothing, so auto-merge has no queue to wait behind and
    // the arm mutation would be rejected "clean status" — every run, no setting
    // to fix (#677). Skip the doomed arm; wait for this run's own dispatched
    // evidence and land on it. Delivery must land every cycle, not heal next cycle.
    log(`${base} requires nothing to merge — skipping the doomed auto-merge arm;`
      + ` waiting for this run's ${expected} dispatched run(s) and landing PR #${pr.number} here`);
    merged = await landNow({ token, repo, pr, delivery, expected, log });
  } else if (action === 'arm' && pr.node_id) {
    // Surfaced, not swallowed: a failed arm is why a delivered PR sits open
    // forever, and the two usual causes are both fixable repo settings.
    const armed = await enableAutoMerge(token, pr.node_id).then(() => true)
      .catch((e) => {
        log(`could not arm auto-merge on PR #${pr.number}: ${e.message}`
          + ' — check Settings → General → "Allow auto-merge", and Settings → Actions → General for a'
          + ' workflow-approval requirement parking this PR\'s pull_request run at action_required.'
          + ' Waiting for this run\'s dispatched checks and landing it here.');
        return false;
      });
    // Only where the arm failed. A member that armed is GitHub's to land, and
    // waiting on it here would add a poll to every healthy repo for nothing.
    if (!armed) merged = await landNow({ token, repo, pr, delivery, expected, log });
  }
  return { merged, action };
}
