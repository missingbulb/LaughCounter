// The executor (tasks-dispatch DESIGN §6) — a pull worker over the queue. Each
// iteration: pick the next ready item, claim it by a verified lease, evaluate the
// precondition (THE only place it is ever evaluated), then on a go run code-work and
// either converge (agentless) or hand off to an agent session; on a no-go roll a
// scheduled item to its next anchor with the reason on record.
//
// An executor's whole interface is issue read/write plus the repo at HEAD, which
// is what makes it platform-agnostic: the reference deployment is a job in the
// vendored workflows (the scheduler run's post-scheduler run drain, and a `labeled`-event run for
// latency), but a runner anywhere with an issues-scope token qualifies. Nothing
// enumerates executors; identity is self-declared in the claim comment.
//
// The pure decisions live at the top and test with fixtures; the shell below is
// the GitHub/code-work/invocation I/O around them.

import { pathToFileURL } from 'node:url';
import { isSuspended, suspendedNotice } from './suspend.mjs';
import { nextAnchor } from './anchors.mjs';
import { readyDependents } from './readiness.mjs';
import { HEARTBEAT_MS, heartbeatComment, withHeartbeat } from './heartbeat.mjs';
import { renderTaskExec } from '../run-record.mjs';
import {
  READY, URGENT, EXECUTING, AGENT, BLOCKED, NEEDS_HUMAN,
  TASK_DONE, TASK_OBSOLETE, QUEUE_LABELS, REQUEST_LABELS, QUEUED_LABEL, isStandingItem,
  NEEDS_HUMAN_ACTION, NEEDS_HUMAN_APPROVAL, NEEDS_HUMAN_FAILURE, triageLabelFor,
  CLAIM_MARKER, HANDOFF_MARKER, EPISODE_MARKER,
  parseWorkItemTitle, parseWorkItemBody, parseContextLines, mergeContext, withNotBefore, withSection, hasLabel, DELIVERED_HEADING, LEGACY_DELIVERED_HEADINGS,
  LAST_VERDICT_HEADING, lastVerdictLines } from './work-item.mjs';

const titleOf = (item) => (item.title ?? '').trim();
const taskIdOf = (item) => {
  const p = parseWorkItemTitle(item.title);
  return p ? `${p.pack}/${p.task}` : null;
};

// The pick order (DESIGN §6.1): urgent first, then RANDOM among the ready, with
// two skip rules read live at pick time. Random rather than oldest-first because
// nothing leans on FIFO aging — the stale-ready escalation is period-scale — while
// a deterministic order lets one unlucky head dominate every run of a chain
// (DESIGN §15.20).
//
//  - SAME-TITLE MUTEX (S15/F6): skip an item whose exact title has another open
//    item executing or handed to an agent — one task, one execution at a time,
//    while a fan-out's distinct qualifiers still parallelize.
//  - THE `after` YIELD (S24): skip a scheduled item whose task declares `after:
//    [T]` while T's standing item is live THIS CYCLE (ready / executing / agent).
//    A rolled upstream (blocked until its next anchor: it declined this cycle)
//    does not block, and neither does one sitting `needs-human` — a broken
//    upstream must not halt its dependents indefinitely. Deliberately NOT a
//    `Blocked-by` edge: a standing item that rolls never closes, so blocked-by
//    would starve every dependent of a quiet upstream forever.
//
// `open` is every open work item; `taskAfter(id)` gives a task's declared
// upstreams as `<pack>/<task>` ids, and `frequencyOf(id)` that task's declared
// frequency at HEAD — which is half of what says whether an item is a standing
// occurrence or an ad-hoc run (§15.26). `random` is the tie-break draw, injected
// so a test can pin an order the production call deliberately does not have.
export function pickOrder(open = [], { taskAfter = () => [], frequencyOf = () => null, random = Math.random } = {}) {
  const live = (item) => hasLabel(item, READY) || hasLabel(item, EXECUTING) || hasLabel(item, AGENT);
  const standing = (item) => isStandingItem(item, frequencyOf(taskIdOf(item)));
  const liveUpstream = (upstreamId) => open.some((o) =>
    taskIdOf(o) === upstreamId && standing(o) && live(o));
  // One draw per item, taken once: a comparator that called `random()` per
  // comparison would not be a consistent ordering, and `Array.sort` on one is
  // free to produce anything at all.
  const draw = new Map(open.map((i) => [i.number, random()]));

  return open
    .filter((i) => hasLabel(i, READY) && !hasLabel(i, NEEDS_HUMAN))
    .filter((i) => !open.some((o) => o.number !== i.number && titleOf(o) === titleOf(i)
      && (hasLabel(o, EXECUTING) || hasLabel(o, AGENT))))
    .filter((i) => {
      if (!standing(i)) return true;
      return !taskAfter(taskIdOf(i)).some(liveUpstream);
    })
    .sort((a, b) =>
      (hasLabel(b, URGENT) ? 1 : 0) - (hasLabel(a, URGENT) ? 1 : 0)
      || draw.get(a.number) - draw.get(b.number));
}

// The claim comment carries WHO and WHEN — the executor id and its run URL —
// because executor identity is an unbounded set and must never become a label
// (DESIGN §4).
export const claimComment = ({ executor, runUrl, at }) =>
  `${CLAIM_MARKER}\nClaimed by executor \`${executor}\` at ${at}.${runUrl ? `\n\nRun: ${runUrl}` : ''}`;

// Who won the claim, out of an item's comments (DESIGN §6.2). Three precisions,
// each an implicit assumption made explicit:
//
//  - "EARLIEST" MEANS LOWEST COMMENT ID, never timestamp. GitHub comment
//    `created_at` has one-second granularity, so simultaneous claims tie on time;
//    comment ids are server-assigned and strictly increasing — a total order the
//    protocol gets for free. Nothing here compares runner clocks.
//  - THE ARBITER IS EPISODE-SCOPED (F18): the earliest claim SINCE the item last
//    became ready. Over an item's lifetime dead claims accumulate (every reclaim
//    and revert leaves one), and arbitrating over all of them makes a dead claim
//    outrank every future live claimant — the item then livelocks through reclaim
//    cycles forever. The reclaim / revert / re-queue comment is the boundary.
//  - THE LABEL SWAP IS NOT THE ARBITER, so a torn swap can never mint a second
//    owner; it can only leave an item with no state label, which the janitor
//    repairs.
export function claimWinner(comments = []) {
  const sorted = [...comments].sort((a, b) => a.id - b.id);
  const boundary = sorted.filter((c) => (c.body ?? '').includes(EPISODE_MARKER)).at(-1);
  const claims = sorted
    .filter((c) => (c.body ?? '').includes(CLAIM_MARKER))
    .filter((c) => !boundary || c.id > boundary.id);
  return claims[0] ?? null;
}

// After WINNING a claim, re-verify the pick filters against live state (F15). The
// filters read possibly-stale state, so two executors can pass them simultaneously
// and claim DIFFERENT items the filters should have serialized — a twin pair, or
// an upstream and its dependent. The per-item lease cannot see that: it protects
// one item, not one title. If a conflicting item now holds an EARLIER claim
// (comment id — the same arbiter the lease trusts), this executor reverts its own
// claim and moves on. Bounded, deterministic, and the earlier claim never notices.
export function conflictsWithEarlierClaim(item, myClaimId, others, { taskAfter = () => [], frequencyOf = () => null } = {}) {
  const standing = (i) => isStandingItem(i, frequencyOf(taskIdOf(i)));
  const upstreams = standing(item) ? taskAfter(taskIdOf(item)) : [];
  return others.some((o) => {
    if (o.number === item.number) return false;
    if (!(hasLabel(o, EXECUTING) || hasLabel(o, AGENT))) return false;
    const conflicting = titleOf(o) === titleOf(item)
      || (upstreams.includes(taskIdOf(o)) && standing(o));
    return conflicting && o.claimId != null && o.claimId < myClaimId;
  });
}

// The no-go outcome (DESIGN §6.4). A SCHEDULED item rolls — `Not-before` stamped
// with the task's next anchor, ready → blocked, the reason recorded — so the item
// itself carries "asked, declined, wakes at T" and the scheduler run is a pure function of
// the clock and the issue list. An AD-HOC item has no next anchor to roll to, so
// it closes obsolete with the reason commented (a follow-up whose world settled on
// its own, S17).
export function noGoPlan(item, task, schedule, now, reason) {
  if (!isStandingItem(item, task?.decl?.frequency)) {
    return { kind: 'close', outcome: TASK_OBSOLETE, stateReason: 'not_planned', reason };
  }
  const until = nextAnchor(task.decl.frequency, schedule, now);
  return { kind: 'roll', until: until ? until.toISOString() : null, reason };
}

// --- the shell ----------------------------------------------------------------

const nowIso = () => new Date().toISOString();

// ONE EXECUTOR RUN PERFORMS ONE ITEM (DESIGN §6, §10, decision §15.22). Not a
// configured maximum — the essence of an executor: it claims one item, sees it to
// its settle, and ends. Capacity is executor width, and the queue drains as a
// CHAIN of runs, each cause on the record (§10): the scheduler run's own drain job, a
// label event, the close-time drain, this run's own `redispatch`, and the
// workflow's failure-continuation job when a run dies before reaching it.
//
// A run that never gets its item — nothing pickable, or another executor holds
// this episode's earlier claim — ends without dispatching anything. Retrying a
// lost race here would be a second pick attempt racing the very executor that
// won, and re-dispatching over a claim we just reverted is a two-executor
// dispatch loop; in both cases the winner's own chain (or the scheduler run behind it)
// carries the queue.
//
// Injected seams keep the run testable end to end without GitHub, code-work
// subprocesses or an invocation endpoint.
export async function runExecutor({
  gh, repo, root, config, tasks, executorId, runUrl = null,
  now = () => new Date(), random = Math.random, heartbeatMs = HEARTBEAT_MS,
  collectSignalsFor, runTaskCodeWork, invokeAgent, redispatch = null, log = console.log,
}) {
  const api = await import('../github.mjs');
  const { listOpenWorkItems } = await import('./read.mjs');
  const schedule = config.taskScheduler;
  const byId = new Map(tasks.map((t) => [`${t.pack}/${t.id}`, t]));
  const taskAfter = (id) => byId.get(id)?.decl?.after ?? [];
  const frequencyOf = (id) => byId.get(id)?.decl?.frequency ?? null;
  const done = [];

  const open = await listOpenWorkItems(gh, repo);
  const candidate = pickOrder(open, { taskAfter, frequencyOf, random })[0];
  if (!candidate) return done;

  // --- claim: the verified lease --------------------------------------------
  await api.swapLabel(gh, repo, candidate.number, READY, EXECUTING);
  await api.comment(gh, repo, candidate.number, claimComment({
    executor: executorId, runUrl, at: nowIso(),
  }));
  const comments = await api.listComments(gh, repo, candidate.number);
  const winner = claimWinner(comments);
  const mine = [...comments]
    .sort((a, b) => a.id - b.id)
    .filter((c) => (c.body ?? '').includes(CLAIM_MARKER) && (c.body ?? '').includes(`executor \`${executorId}\``))
    .at(-1);
  if (!winner || winner.id !== mine?.id) {
    // The loser reverts nothing — the winner's labels already stand. It does
    // strike its own claim (F24): letting go covers losing too, and a claim left
    // behind here outlives the winner's episode and becomes the earliest of the
    // NEXT one, moving the livelock one episode along.
    await strikeClaim(api, gh, repo, mine);
    log(`- #${candidate.number}: another executor holds this episode's earliest claim — this run stands down`);
    return done;
  }

  // --- post-claim re-verify (F15) -------------------------------------------
  const others = await withClaimIds(api, gh, repo, await listOpenWorkItems(gh, repo), candidate.number);
  if (conflictsWithEarlierClaim(candidate, winner.id, others, { taskAfter, frequencyOf })) {
    await api.comment(gh, repo, candidate.number,
      `${EPISODE_MARKER}\nReverting this claim: a conflicting item holds an earlier claim this cycle. Returning the item to the queue.`);
    await api.swapLabel(gh, repo, candidate.number, EXECUTING, READY);
    log(`- #${candidate.number}: reverted — a conflicting item claimed earlier`);
    return done;
  }

  const outcome = await executeItem({
    api, gh, repo, root, config, schedule, byId, item: candidate, executorId,
    claim: winner, now, heartbeatMs, collectSignalsFor, runTaskCodeWork, invokeAgent, log,
  });
  done.push({ issue: candidate.number, outcome });

  // --- the chain: hand the remainder to a fresh run -------------------------
  // Read live, after the settle: this item's convergence may have readied a
  // dependent, and another executor may have taken what was pickable when this
  // run started.
  if (redispatch) {
    const left = pickOrder(await listOpenWorkItems(gh, repo), { taskAfter, frequencyOf, random });
    if (left.length) {
      const res = await redispatch();
      log(res?.ok
        ? `- ${left.length} item(s) still pickable — dispatched a fresh executor run`
        : `! ${left.length} item(s) still pickable but the re-dispatch failed (${res?.status ?? 'no status'}) — the scheduler run's drain is the backstop`);
    }
  }
  return done;
}

// The claim id of each live item, so the post-claim verify can compare episodes.
// One comment read per conflicting-looking item, not per item in the repo.
async function withClaimIds(api, gh, repo, items, selfNumber) {
  const out = [];
  for (const i of items) {
    if (i.number === selfNumber || !(hasLabel(i, EXECUTING) || hasLabel(i, AGENT))) { out.push(i); continue; }
    const winner = claimWinner(await api.listComments(gh, repo, i.number));
    out.push({ ...i, claimId: winner?.id ?? null });
  }
  return out;
}

// One claimed item, from validation through to a terminal state (or a hand-off).
async function executeItem({
  api, gh, repo, root, config, schedule, byId, item, executorId, claim,
  now, heartbeatMs, collectSignalsFor, runTaskCodeWork, invokeAgent, log,
}) {
  // What a close needs beyond the item itself: the clock for a dependent's
  // `Not-before`, and somewhere to say what it released.
  const ctx = { now, log };
  const parsed = parseWorkItemTitle(item.title);
  const { taskPath } = parseWorkItemBody(item.body);
  const id = parsed ? `${parsed.pack}/${parsed.task}` : null;
  const task = id ? byId.get(id) : null;

  // --- validate in code, before anything trusts the issue ------------------
  if (!parsed || !taskPath) {
    await converge(api, gh, repo, item, EXECUTING, NEEDS_HUMAN_FAILURE, claim,
      'This work item is malformed — its title or first body line does not name a task. Possible forgery; a human should look at it.', 'invalid');
    return 'needs-human';
  }
  if (!task) {
    await close(api, gh, repo, item, EXECUTING, TASK_OBSOLETE, 'not_planned',
      `\`${id}\` is not a task this repo carries at HEAD (the pack may be undeclared, or the task removed). Closing obsolete.`, 'task-gone', ctx);
    return 'obsolete';
  }
  if (task.taskPath !== taskPath) {
    await converge(api, gh, repo, item, EXECUTING, NEEDS_HUMAN_FAILURE, claim,
      `This item's task path (\`${taskPath}\`) is not where \`${id}\` lives at HEAD (\`${task.taskPath}\`). Not running it.`, 'invalid');
    return 'needs-human';
  }

  // --- the single precondition evaluation (DESIGN §6.4) --------------------
  const at = now();
  const fields = parseWorkItemBody(item.body);
  // The signals are collected FOR THIS OCCURRENCE, and the precondition judges over
  // it: a request item's verdict is about the issue it names, which no signal bundle
  // can single out on its own (DESIGN §16.4).
  const signals = await collectSignalsFor(task, at, item);
  const verdict = evaluatePrecondition(task, signals, config.packConfig?.[task.pack] ?? {}, fields);

  // A PRECONDITION THAT COULD NOT ANSWER IS A RUN FAILURE, NOT A VERDICT (F27). A
  // decline is a decision about the world; one taken on an API that would not answer
  // is a guess, and its write-backs cannot land — for a request that would strand
  // the issue armed-but-queued forever, the request silently eaten. So the item
  // parks open in the failure lane, where the ordinary re-queue lever retries it
  // once the API recovers, and nothing is written to whatever it could not read.
  if (verdict.error) {
    await converge(api, gh, repo, item, EXECUTING, NEEDS_HUMAN_FAILURE, claim,
      `This run could not be decided: ${verdict.error}\n\nNothing ran and nothing was written. Re-queue this item (remove the \`${NEEDS_HUMAN}\` labels, add \`${READY}\`) once the cause has cleared.`);
    log(`! #${item.number} ${id}: the precondition could not answer — ${verdict.error}`);
    return 'needs-human';
  }

  if (verdict.run !== true) {
    const plan = noGoPlan(item, task, schedule, at, verdict.reason || 'no work');
    if (plan.kind === 'close') {
      // A DECLINED REQUEST IS DISARMED IN THE SAME CONVERGENCE (DESIGN §16.5).
      // Nothing else would: an issue left carrying `claude-queued` after its run was
      // refused is one no later scheduler run adopts and no person is told about, and one
      // whose mark — if re-applied — walks into the same refusal forever.
      if (fields.request) await declineRequest(api, gh, repo, fields.request, item.number, plan.reason);
      // A DECLINE IS A COMPLETED RUN, not a failure: the executor asked, got a
      // no, and closed the occurrence — so the record says `success` and the
      // reason sits beside it in the same comment.
      await close(api, gh, repo, item, EXECUTING, TASK_OBSOLETE, 'not_planned',
        `The precondition declined and this item has no anchor to roll to: ${plan.reason}`, 'success', ctx);
      return 'obsolete';
    }
    // The roll writes no comment — the `Not-before` bump IS the record, and an
    // hourly task that stays quiet would otherwise fill its own timeline (§5).
    // Which is exactly why the claim is STRUCK rather than closed by a marker
    // comment: the episode has to end here (F24) without costing a timeline entry.
    await strikeClaim(api, gh, repo, claim);
    await gh(`/repos/${repo}/issues/${item.number}`, {
      method: 'PATCH',
      body: { body: rollBody(item.body, plan.until, plan.reason, at.toISOString()) },
    });
    await api.swapLabel(gh, repo, item.number, EXECUTING, BLOCKED);
    log(`- #${item.number} ${id}: rolled to ${plan.until} — ${plan.reason}`);
    return 'rolled';
  }

  // --- code-work (unchanged contract), then converge or hand off -------------
  // The item's OWN Context is scope too, not decoration: an operator's parameters
  // (`create-work-item --context "REPOS=Alpha Beta"`) live there and nowhere else,
  // so code-work sees the union of what the item was created with and what this
  // occurrence's precondition added. Passing only the verdict's half is what made
  // a hand-created item's parameters unreachable (#974).
  const context = mergeContext(parseContextLines(item.body), verdict.context ?? []);
  if (task.decl.code_work) {
    // The work step may legitimately run for hours (§15.15). While it does, the
    // item's only sign of life is this beat — which is also what the scheduler run's leash
    // measures, so a long run is legal rather than reclaimed underneath itself.
    const result = await withHeartbeat(() => runTaskCodeWork(task, { item, context }), {
      intervalMs: heartbeatMs,
      log,
      beat: (minutes) => api.comment(gh, repo, item.number,
        heartbeatComment({ executor: executorId, at: nowIso(), minutes })),
    });
    if (!result.ok) {
      // The worker's own verdict routes the park where it left one; a worker that
      // said nothing about why it failed is a `failure` — the lane that means
      // "someone reads the trace", which is the only safe default for a run whose
      // cause is unknown.
      await converge(api, gh, repo, item, EXECUTING, triageLabelFor(result.triage?.kind), claim,
        `Code-work failed: ${result.why}${result.triage?.detail ? `\n\nThe worker's own verdict: ${result.triage.detail}` : ''}`
        + `${result.detail ? `\n\n\`\`\`\n${result.detail}\n\`\`\`` : ''}`);
      return 'needs-human';
    }
    if (result.missingSecrets?.length) {
      await converge(api, gh, repo, item, EXECUTING, NEEDS_HUMAN_ACTION, claim,
        `This task declares repo Actions secrets that are not configured: ${result.missingSecrets.join(', ')}. Set them in repo settings and re-queue this item (remove the \`needs-human\` labels, add \`task:ready\`).`);
      return 'needs-human';
    }
    if (!result.agentRequested) {
      // A run that deliberately left an UNMERGED PR is not finished, it is waiting
      // on a person — so the item stays OPEN at `task:needs-human-approval` rather
      // than closing as delivered. It does not hold the task's lane while it waits
      // (`isBlockingPark`): the next occurrence is filed on schedule around it, so
      // an unreviewed PR delays nobody but its reviewer.
      if (result.openPr) {
        await converge(api, gh, repo, item, EXECUTING, NEEDS_HUMAN_APPROVAL, claim,
          `Code-work did this run's work and opened a PR for you to approve:\n${result.delivered.map((d) => `- ${d}`).join('\n')}`
          + `\n\nMerge or close #${result.openPr}, then close this item. This task keeps running on schedule meanwhile.`, null);
        return 'needs-human';
      }
      await close(api, gh, repo, item, EXECUTING, TASK_DONE, 'completed',
        result.delivered?.length
          ? `Code-work did this run's work and left:\n${result.delivered.map((d) => `- ${d}`).join('\n')}`
          : 'Code-work did this run\'s work; no agent was needed.', 'success', ctx);
      return TASK_DONE;
    }
    return handOff({ api, gh, repo, item, task, id, context, result, executorId, claim, invokeAgent, config, log });
  }

  // An agentless task with no code-work does nothing (the contract forbids it).
  if (task.decl.agent_model === 'none') {
    await converge(api, gh, repo, item, EXECUTING, NEEDS_HUMAN_FAILURE, claim,
      'This task is agentless but declares no code_work, so there is nothing to run — a contract-forbidden shape that reached the queue.', 'invalid');
    return 'needs-human';
  }
  return handOff({ api, gh, repo, item, task, id, context, result: {}, executorId, claim, invokeAgent, config, log });
}

// The roll's body edit: stamp the next anchor and keep the last reason where an
// operator reads it. The reason REPLACES the previous one — the item is a status
// line, not a log; its timeline carries the history.
// Run one task's precondition. THE only place a precondition is ever called, so a
// test that drives this drives what production drives — a precondition first
// written to take `{ signals }` passed its own direct-call test and threw on every
// real run, which is the failure this seam exists to make impossible.
//
// A throwing precondition converges to a no-go with the error as its reason: one
// task's bad verdict is that item's problem, never the executor's.
export function evaluatePrecondition(task, signals, packConfig = {}, item = null) {
  try {
    return task.decl.precondition(signals, packConfig, item) ?? {};
  } catch (e) {
    return { run: false, reason: `precondition threw: ${e.message}` };
  }
}

// The write-back a refused request gets (DESIGN §16.5): one comment saying why, and
// the queued label off, so the request is disarmed rather than left looking pending.
// It is the executor's because the executor is what converged the item — whoever
// converges owns the write-back for the end they converged.
async function declineRequest(api, gh, repo, request, item, reason) {
  await api.comment(gh, repo, request,
    `Not implementing this: ${reason}\n\nThe queued run (#${item}) is closed and \`${QUEUED_LABEL}\` is removed. `
    + 'If this was wrong, mark the issue again — a request is only run when the person who opened it, or somebody who commented `/claude go`, has push access here.');
  await api.removeLabel(gh, repo, request, QUEUED_LABEL);
}

export function rollBody(body, until, reason, at) {
  const stamped = withNotBefore(body, until);
  return withSection(stamped, LAST_VERDICT_HEADING, lastVerdictLines({ at, reason, until }));
}

// Hand off to an agent session (DESIGN §6.6). ONE call per item, ever — which is
// what lets this be as short as it is. The nonce goes on the item before the call
// and travels in the payload, so the session can prove the fire it arrived on is
// the hand-off this item recorded and stop if it is not.
async function handOff({ api, gh, repo, item, task, id, context, result, executorId, claim, invokeAgent, config, log }) {
  const nonce = `${item.number}-${Math.random().toString(36).slice(2, 10)}`;
  let body = item.body;
  if (context.length) body = withSection(body, 'Context', context);
  if (result.delivered?.length) body = withSection(body, DELIVERED_HEADING, result.delivered, LEGACY_DELIVERED_HEADINGS);
  if (result.reason) body = withSection(body, 'Why the agent is here', [result.reason]);
  await gh(`/repos/${repo}/issues/${item.number}`, { method: 'PATCH', body: { body } });

  await api.swapLabel(gh, repo, item.number, EXECUTING, AGENT);
  await api.comment(gh, repo, item.number,
    `${HANDOFF_MARKER}\nHanded off by executor \`${executorId}\` — invocation nonce \`${nonce}\`.`);

  const invocation = await invokeAgent({ task, item, nonce, config });
  if (invocation.ok) {
    await api.comment(gh, repo, item.number,
      `Agent session started${invocation.sessionUrl ? `: ${invocation.sessionUrl}` : ''}.`);
    log(`- #${item.number} ${id}: handed off${invocation.sessionId ? ` (${invocation.sessionId})` : ''}`);
    return 'agent';
  }
  if (invocation.answered) {
    // The endpoint refused, so no session exists and none will: a token, a URL or
    // a routine is wrong, and every future pick would be refused the same way.
    await converge(api, gh, repo, item, AGENT, NEEDS_HUMAN_ACTION, claim,
      `Could not start an agent session: ${invocation.error}\n\nNo session was started. Fix the invocation endpoint, then re-queue this item (remove the \`${NEEDS_HUMAN}\` labels, add \`${READY}\`).`);
    return 'needs-human';
  }
  // NOTHING CAME BACK, and this is the case the whole design turns on: the call
  // may have started a session. Re-queueing here is what would put two sessions on
  // one item, and converging to triage would kill a run that is very possibly
  // alive. So the item STAYS with the agent and says the outcome is unknown —
  // whichever way it went is then settled by a rule that already exists: a session
  // that started converges the item, and one that never did leaves the item silent
  // until the janitor's agent leash sweeps it to triage.
  await api.comment(gh, repo, item.number,
    `The agent invocation got no answer: ${invocation.error}\n\n`
    + 'The session may or may not have started, so nothing here re-tries it — a second call could put two sessions on this item. '
    + `If a session did start it will converge this item; if it did not, the janitor's agent leash brings this item to \`${NEEDS_HUMAN}\` within a few hours.`);
  log(`! #${item.number} ${id}: invocation unanswered — left with the agent, leash decides — ${invocation.error}`);
  return 'unknown';
}

// LETTING GO OF AN OPEN ITEM KILLS YOUR CLAIM (DESIGN §6.2, F24). An executor
// that stops owning an item without closing it — the roll, and every
// `needs-human` park — strikes its own claim by appending the episode marker to
// it. `claimWinner` already treats the last marker as the boundary, so a struck
// claim stops outranking anything and the next claimant wins on its first try.
//
// APPENDING rather than commenting is what lets the roll stay silent (§5): an
// hourly task that declines every hour adds no timeline entry. A successful
// hand-off deliberately does NOT strike — the episode is still live, owned by the
// agent session — and neither does a close, since nothing re-claims a closed item.
//
// Struck BEFORE the label swap, so the crash window degrades the safe way: an
// executor that dies between the two leaves the item `task:executing` with a
// spent claim, which the scheduler run's leash reclaim already recovers. Striking after
// would leave exactly the state this fixes — parked, re-queued by a human, and
// unclaimable forever.
async function strikeClaim(api, gh, repo, claim) {
  if (!claim || (claim.body ?? '').includes(EPISODE_MARKER)) return;
  await api.editComment(gh, repo, claim.id,
    `${claim.body}\n\n${EPISODE_MARKER}\nThis claim is spent — the executor released this item without closing it.`);
}

// Every exit converges the item exactly once, with one comment saying what
// happened — the terminal-state discipline the incidents bought. The claim sits
// before the body so every state argument is grouped ahead of the prose.
//
// THE COMMENT CARRIES THE EXECUTION RECORD (DESIGN §6.5, §15.18). Actions logs
// expire, and for an agentless run — the majority — the item is the only durable
// trace there will ever be, so the record goes where the item is rather than into
// a log that ages out. The bracketed field is this item's issue number, which is
// the only join from a record back to the work it describes.
// A status of `null` writes NO record, and that is the honest answer for a park
// that is not a failure: the vocabulary's `success` means "ran to completion and
// the issue was closed" and `failed` means the run broke, so an approval park —
// a run that succeeded and left a PR for a person — is neither. Absence is a
// state of its own; inventing a fifth status is a change to stored data every
// decoder in the fleet would have to learn.
const recordFor = (item, status) => {
  const parsed = status ? parseWorkItemTitle(item.title) : null;
  return parsed
    ? `\n\n\`\`\`\n${renderTaskExec({ pack: parsed.pack, task: parsed.task, slotId: `#${item.number}`, status })}\n\`\`\``
    : '';
};

// Park an item for a human. BOTH labels, always: `needs-human` is the state every
// guard and sweep reads, `triage` is what the human is being asked for.
async function converge(api, gh, repo, item, from, triage, claim, body, status = 'failed') {
  await strikeClaim(api, gh, repo, claim);
  await api.comment(gh, repo, item.number, body + recordFor(item, status));
  await api.swapLabel(gh, repo, item.number, from, NEEDS_HUMAN);
  await api.addLabel(gh, repo, item.number, triage);
}

// A close is also the moment a dependent may become due (§15.19): whoever closes
// an item releases what it was holding, in code, and the run's own re-dispatch
// then finds it. The scheduler run stays the backstop for every close this code never
// performs — a human's, or a session that stopped early.
async function close(api, gh, repo, item, from, outcome, stateReason, body, status, ctx = {}) {
  await api.comment(gh, repo, item.number, body + recordFor(item, status));
  await api.removeLabel(gh, repo, item.number, from);
  await api.addLabel(gh, repo, item.number, outcome);
  await api.closeIssue(gh, repo, item.number, stateReason);
  await readyDependents(api, gh, repo, item.number, ctx);
}

// --- CLI ----------------------------------------------------------------------

async function main() {
  // THE OPERATOR HOLD, FIRST ACT (§15.24) — before the config load, before the
  // first API call, so a held queue reads nothing and writes nothing rather than
  // deriving the world and then declining to act on it.
  if (isSuspended()) { console.log('## Claudinite executor\n'); console.log(suspendedNotice()); return; }
  const { makeGh, actionRepoContext, EXECUTOR_WORKFLOW_FILE } = await import('../signals/gh.mjs');
  const { discoverTasks } = await import('../discover.mjs');
  const { loadConfig, isDormant } = await import('../../checks/helpers/repo-context.mjs');
  const { ensureLabels, dispatchWorkflow } = await import('../github.mjs');
  const { collectSignalsForTask } = await import('./signals.mjs');
  const { codeWorkRunner } = await import('./code-work-run.mjs');
  const { agentInvoker } = await import('./invoke.mjs');

  const root = process.cwd();
  const { repo, defaultBranch } = actionRepoContext();
  if (!repo) { console.error('GITHUB_REPOSITORY not set — not in an Actions context'); process.exit(1); }
  const config = loadConfig(root);

  console.log('## Claudinite executor\n');
  if (isDormant(config)) {
    console.log('- this project declares itself dormant — nothing is picked up');
    return;
  }

  const gh = makeGh();
  const { tasks, errors } = await discoverTasks(root, config);
  for (const e of errors) console.log(`! ${e.what}`);
  await ensureLabels(gh, repo, [...QUEUE_LABELS, ...REQUEST_LABELS]);

  const runUrl = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null;

  const done = await runExecutor({
    gh, repo, root, config, tasks,
    executorId: process.env.CLAUDINITE_EXECUTOR_ID || `actions-${process.env.GITHUB_RUN_ID ?? 'local'}`,
    runUrl,
    collectSignalsFor: collectSignalsForTask({ gh, repo, root, config, defaultBranch }),
    runTaskCodeWork: codeWorkRunner({ root, repo, defaultBranch }),
    invokeAgent: agentInvoker({ repo, config }),
    redispatch: () => dispatchWorkflow(gh, repo, EXECUTOR_WORKFLOW_FILE, defaultBranch),
  });

  console.log(done.length
    ? done.map((d) => `- #${d.issue}: ${d.outcome}`).join('\n')
    : '- nothing ready to pick up');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
