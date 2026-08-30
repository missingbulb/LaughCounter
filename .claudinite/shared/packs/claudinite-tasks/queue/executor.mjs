// The executor (tasks-dispatch DESIGN §6) — a pull worker over the queue. Each
// iteration: pick the next ready item, claim it by a verified lease, re-evaluate
// the precondition (the scheduler run asked once at the anchor; a chained stage
// re-derives world state rather than trusting a verdict passed forward), then on
// a go run code-work and either converge (agentless) or hand off to an agent
// session; on a no-go close the item with the reason on record — the next
// occurrence is the scheduler run's ask at the task's next anchor (#1115).
//
// An executor's whole interface is issue read/write plus the repo at HEAD, which
// is what makes it platform-agnostic: the reference deployment is a job in the
// vendored workflows (the scheduler run's post-scheduler run drain, and a `labeled`-event run for
// latency), but a runner anywhere with an issues-scope token qualifies. Nothing
// enumerates executors; identity is self-declared in the claim comment.
//
// The pure decisions live at the top and test with fixtures; the shell below is
// the GitHub/code-work/invocation I/O around them.

import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isSuspended, readSuspendedNow, suspendedNotice, SUSPEND_ALL_VAR } from './suspend.mjs';
import { HEARTBEAT_MS, heartbeatComment, withHeartbeat } from './heartbeat.mjs';
import { renderTaskExec } from '../run-record.mjs';
import { swapStatus, clearStatus } from './apply-status.mjs';
import {
  READY, URGENT, EXECUTING, AGENT, requeueHint,
  STATUS_READY, STATUS_RUNNING_EXECUTOR, STATUS_RUNNING_AGENT, isStatus,
  TASK_DONE, TASK_OBSOLETE, QUEUE_LABELS, QUEUED_LABEL, isStandingItem,
  NEEDS_HUMAN_ACTION, NEEDS_HUMAN_APPROVAL, NEEDS_HUMAN_FAILURE,
  CLAIM_MARKER, HANDOFF_MARKER, EPISODE_MARKER,
  parseWorkItemTitle, isWorkItemTitle, parseWorkItemBody, taskIdFromPath, parseContextLines, mergeContext, withNotBefore, withSection, editItemBody, hasLabel, DELIVERED_HEADING, LEGACY_DELIVERED_HEADINGS,
  LAST_VERDICT_HEADING, lastVerdictLines } from './work-item.mjs';

const titleOf = (item) => (item.title ?? '').trim();
// An item somebody is executing — the executor holds it, or the agent it handed to
// does. Decoded, never a literal label test: the item may wear any engine's spelling.
const running = (item) => isStatus(item, STATUS_RUNNING_EXECUTOR) || isStatus(item, STATUS_RUNNING_AGENT);
// WHICH TASK AN ITEM NAMES. A filed `[claudinite-work]` item says so in its title;
// a marked issue (DESIGN §16.1) keeps its own human title and names its task in the
// machine block's first line, so the id comes from the task whose worker path that
// is. `pathTo` is that lookup, injected because only the run holds the task set.
const taskIdOf = (item, pathTo = () => null) => {
  const p = parseWorkItemTitle(item.title);
  if (p) return `${p.pack}/${p.task}`;
  return pathTo(parseWorkItemBody(item.body).taskPath) ?? null;
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
//  - THE `after` YIELD (S23): skip a scheduled item whose task declares `after:
//    [T]` while T's standing item is live THIS CYCLE (ready / executing / agent).
//    A declined upstream holds nothing back — it has no item at all (a no files
//    only a board row, #1115) — and neither does one sitting `needs-human`: a
//    broken upstream must not halt its dependents indefinitely.
//
// `open` is every open work item; `taskAfter(id)` gives a task's declared
// upstreams as `<pack>/<task>` ids, and `frequencyOf(id)` that task's declared
// frequency at HEAD — which is half of what says whether an item is a standing
// occurrence or an ad-hoc run (§15.26). `random` is the tie-break draw, injected
// so a test can pin an order the production call deliberately does not have.
export function pickOrder(open = [], { taskAfter = () => [], frequencyOf = () => null, random = Math.random, pathTo = () => null } = {}) {
  const idOf = (item) => taskIdOf(item, pathTo);
  const live = (item) => [STATUS_READY, STATUS_RUNNING_EXECUTOR, STATUS_RUNNING_AGENT].some((s) => isStatus(item, s));
  const standing = (item) => isStandingItem(item, frequencyOf(idOf(item)));
  const liveUpstream = (upstreamId) => open.some((o) =>
    idOf(o) === upstreamId && standing(o) && live(o));
  // One draw per item, taken once: a comparator that called `random()` per
  // comparison would not be a consistent ordering, and `Array.sort` on one is
  // free to produce anything at all.
  const draw = new Map(open.map((i) => [i.number, random()]));

  return open
    .filter((i) => isStatus(i, STATUS_READY))
    .filter((i) => !open.some((o) => o.number !== i.number && titleOf(o) === titleOf(i)
      && running(o)))
    .filter((i) => {
      if (!standing(i)) return true;
      return !taskAfter(idOf(i)).some(liveUpstream);
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
export function conflictsWithEarlierClaim(item, myClaimId, others, { taskAfter = () => [], frequencyOf = () => null, pathTo = () => null } = {}) {
  const idOf = (i) => taskIdOf(i, pathTo);
  const standing = (i) => isStandingItem(i, frequencyOf(idOf(i)));
  const upstreams = standing(item) ? taskAfter(idOf(item)) : [];
  return others.some((o) => {
    if (o.number === item.number) return false;
    if (!running(o)) return false;
    const conflicting = titleOf(o) === titleOf(item)
      || (upstreams.includes(idOf(o)) && standing(o));
    return conflicting && o.claimId != null && o.claimId < myClaimId;
  });
}

// The no-go outcome (DESIGN §6.4, as amended by #1115): every decline CLOSES
// the item with the reason. The roll — `Not-before` stamped, open-blocked,
// waiting out the period — is gone: "asked and declined" lives on the schedule
// board, and a scheduled item's next occurrence is the scheduler run's ask at
// its next anchor (the closed-at half of the occurrence guard keeps this
// period consumed). `standing` marks whether the close should say so.
// The `(item, task, schedule, now, reason)` signature is kept — callers and
// fielded tests pass all five, and the standing/ad-hoc distinction still
// shapes the close's wording.
export function noGoPlan(item, task, schedule, now, reason) {
  return {
    kind: 'close',
    outcome: TASK_OBSOLETE,
    stateReason: 'not_planned',
    reason,
    standing: isStandingItem(item, task?.decl?.frequency),
  };
}

// --- the shell ----------------------------------------------------------------

const nowIso = () => new Date().toISOString();

// ONE EXECUTOR RUN DRAINS THE QUEUE (DESIGN §6, §10, decision §15.30, reversing
// §15.22's one-item run). Actions bills each job's runtime rounded UP to the next
// minute, so a day's cost is the RUN count: a run that performed one item paid a
// whole invocation — checkout, setup, rounding — per item. So a run claims an
// item, sees it to its settle, then picks the next, and ends when nothing is
// pickable. Items still settle ONE AT A TIME: this moved the run boundary, not
// the occupancy model, and capacity is still executor width.
//
// What still starts a run is the enumerable list of §10, each cause on the
// record: the scheduler run's drain job (dispatched only when that run leaves
// something pickable), a label event, an agent session's close-time drain, and
// the workflow's failure-continuation job when a run dies mid-drain. Self-
// re-dispatch retired with the one-item run — the remainder is this run's own.
//
// AN ITEM THIS RUN LET GO OF IS NEVER RE-ATTEMPTED BY IT. Losing a claim race
// leaves the item running under its winner, so the next pick simply does not see
// it — but a post-claim REVERT puts the item back to ready, and re-picking what
// this run just returned to the queue is an unbounded loop, not a retry. Both
// exits are therefore recorded in `standDown` and skipped for the rest of the
// run; the executor that won, and the scheduler run behind it, carry those.
//
// The loop terminates because every iteration either settles an item (which
// leaves the ready state) or stands down from one — and the only items that
// newly become pickable are the dependents a close releases, which is the
// chaining this exists to do. Its outer bound is the workflow's own timeout.
//
// Injected seams keep the run testable end to end without GitHub, code-work
// subprocesses or an invocation endpoint. `heldNow` is the operator hold, asked
// between items (§15.30): `vars.*` reaches the env at start only, so a drain that
// outlives the hold's arrival can only see it by asking.
export async function runExecutor({
  gh, repo, root, config, tasks, executorId, runUrl = null,
  now = () => new Date(), random = Math.random, heartbeatMs = HEARTBEAT_MS,
  collectSignalsFor, runTaskCodeWork, invokeAgent, heldNow = null, log = console.log,
}) {
  const api = await import('../github.mjs');
  const { listOpenWorkItems } = await import('./read.mjs');
  const schedule = config.taskScheduler;
  const byId = new Map(tasks.map((t) => [`${t.pack}/${t.id}`, t]));
  const taskAfter = (id) => byId.get(id)?.decl?.schedule_after ?? [];
  const frequencyOf = (id) => byId.get(id)?.decl?.frequency ?? null;
  // A marked issue names its task by worker path, so the run needs the inverse of
  // the id map — built from the same task set, so a path this repo does not carry
  // resolves to nothing and the item is malformed rather than guessed at.
  const byPath = new Map(tasks.map((t) => [t.taskPath, `${t.pack}/${t.id}`]));
  const pathTo = (p) => byPath.get(p) ?? null;
  const done = [];
  // Items this run has let go of — a lost race, a reverted claim — and must not
  // pick again. Without it a revert re-picks what it just returned to the queue.
  const standDown = new Set();

  for (;;) {
    // Read live every time: the settle just made may have readied a dependent,
    // and another executor may have taken what was pickable a moment ago.
    const open = await listOpenWorkItems(gh, repo);
    const candidate = pickOrder(open, { taskAfter, frequencyOf, random, pathTo })
      .find((i) => !standDown.has(i.number));
    if (!candidate) break;

    // --- claim: the verified lease ------------------------------------------
    await swapStatus(api, gh, repo, candidate, STATUS_READY, EXECUTING);
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
      standDown.add(candidate.number);
      log(`- #${candidate.number}: another executor holds this episode's earliest claim — leaving it to them`);
      continue;
    }

    // --- post-claim re-verify (F15) -----------------------------------------
    const others = await withClaimIds(api, gh, repo, await listOpenWorkItems(gh, repo), candidate.number);
    if (conflictsWithEarlierClaim(candidate, winner.id, others, { taskAfter, frequencyOf, pathTo })) {
      await api.comment(gh, repo, candidate.number,
        `${EPISODE_MARKER}\nReverting this claim: a conflicting item holds an earlier claim this cycle. Returning the item to the queue.`);
      await swapStatus(api, gh, repo, candidate, STATUS_RUNNING_EXECUTOR, READY);
      standDown.add(candidate.number);
      log(`- #${candidate.number}: reverted — a conflicting item claimed earlier`);
      continue;
    }

    const outcome = await executeItem({
      api, gh, repo, root, config, schedule, byId, pathTo, item: candidate, executorId,
      claim: winner, now, heartbeatMs, collectSignalsFor, runTaskCodeWork, invokeAgent, log,
    });
    done.push({ issue: candidate.number, outcome });

    // --- the hold, between items (§15.30) -----------------------------------
    // Asked after the settle rather than before the pick that follows it, so a
    // run that had nothing more to do never spends the read. The item just
    // finished is untouched: suspension stops picking, never running work.
    if (heldNow && await heldNow()) {
      log(`- ${SUSPEND_ALL_VAR} is set: this drain stops here, holding nothing. Items stay exactly as they are.`);
      break;
    }
  }
  return done;
}

// The claim id of each live item, so the post-claim verify can compare episodes.
// One comment read per conflicting-looking item, not per item in the repo.
async function withClaimIds(api, gh, repo, items, selfNumber) {
  const out = [];
  for (const i of items) {
    if (i.number === selfNumber || !running(i)) { out.push(i); continue; }
    const winner = claimWinner(await api.listComments(gh, repo, i.number));
    out.push({ ...i, claimId: winner?.id ?? null });
  }
  return out;
}

// One claimed item, from validation through to a terminal state (or a hand-off).
async function executeItem({
  api, gh, repo, root, config, schedule, byId, pathTo = () => null, item, executorId, claim,
  now, heartbeatMs, collectSignalsFor, runTaskCodeWork, invokeAgent, log,
}) {
  const parsed = parseWorkItemTitle(item.title);
  const { taskPath } = parseWorkItemBody(item.body);
  // A marked issue's identity is its machine block, not its title (§16.1): the id
  // is whichever task owns the worker path the block names.
  const id = parsed ? `${parsed.pack}/${parsed.task}` : pathTo(taskPath);
  const task = id ? byId.get(id) : null;
  // The exec record joins back to the work by pack and task, which a marked issue's
  // human title cannot supply — so the resolved id travels with the item.
  item.taskId = id;

  // --- validate in code, before anything trusts the issue ------------------
  if (!taskPath || (!parsed && !id)) {
    await converge(api, gh, repo, item, STATUS_RUNNING_EXECUTOR, NEEDS_HUMAN_FAILURE, claim,
      'This work item is malformed — its title or first body line does not name a task. Possible forgery; a human should look at it.', 'invalid');
    return 'needs-human';
  }
  if (!task) {
    await close(api, gh, repo, item, STATUS_RUNNING_EXECUTOR, TASK_OBSOLETE, 'not_planned',
      `\`${id}\` is not a task this repo carries at HEAD (the pack may be undeclared, or the task removed). Closing obsolete.`, 'task-gone');
    return 'obsolete';
  }
  // THE SAME FACT, LEARNED LATER. The task set was built once, at the start of the
  // run; one run drains several items from one checkout, and an earlier item's own
  // work rewrites that checkout — the mount update deletes a retired task's
  // directory out from under the items behind it. So a task can resolve here and
  // not exist on disk — the same fact the branch above closes on, and it converges
  // the same way. Without this the run reaches code-work and spawns with a cwd that is gone
  // (missingbulb/Shepherd#300).
  if (!existsSync(task.taskDir)) {
    await close(api, gh, repo, item, STATUS_RUNNING_EXECUTOR, TASK_OBSOLETE, 'not_planned',
      `\`${id}\` no longer exists in this checkout (\`${task.taskPath}\`) — it was removed while this run was in flight. Nothing ran. Closing obsolete.`, 'task-gone');
    return 'obsolete';
  }
  if (task.taskPath !== taskPath) {
    // A MISMATCH HAS TWO CAUSES AND ONLY ONE IS A PERSON'S PROBLEM (#1461). The guard
    // exists for a tampered or forged item, whose path names some OTHER task — that
    // parks. But an item open across a pack rename hits it too: only the title's id is
    // canonicalized (`parseWorkItemTitle`), so the body keeps naming the pre-rename
    // directory forever, and parking it strands the item AND holds the task's lane,
    // since nothing rewrites an item body. When the path resolves to this very task —
    // `taskIdFromPath` canonicalizes too — the item is merely stale, which is the
    // `!task` branch's verdict: close it obsolete and let the generator file a fresh
    // occurrence at today's path.
    const named = taskIdFromPath(taskPath);
    if (named && `${named.pack}/${named.task}` === id) {
      await close(api, gh, repo, item, STATUS_RUNNING_EXECUTOR, TASK_OBSOLETE, 'not_planned',
        `This item names \`${id}\` at \`${taskPath}\`, where it no longer lives — the pack was renamed since the item `
        + `was filed, and the task is at \`${task.taskPath}\` now. An item's stored path is never rewritten, so this one `
        + 'can never run. Closing obsolete; the scheduler files a fresh occurrence at the current path.', 'task-gone');
      return 'obsolete';
    }
    await converge(api, gh, repo, item, STATUS_RUNNING_EXECUTOR, NEEDS_HUMAN_FAILURE, claim,
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
    await converge(api, gh, repo, item, STATUS_RUNNING_EXECUTOR, NEEDS_HUMAN_FAILURE, claim,
      `This run could not be decided: ${verdict.error}\n\nNothing ran and nothing was written. Re-queue this item (${requeueHint}) once the cause has cleared.`);
    log(`! #${item.number} ${id}: the precondition could not answer — ${verdict.error}`);
    return 'needs-human';
  }

  if (verdict.run !== true) {
    const plan = noGoPlan(item, task, schedule, at, verdict.reason || 'no work');
    // A DECLINED REQUEST IS DISARMED IN THE SAME CONVERGENCE (DESIGN §16.5).
    // Nothing else would: an issue left carrying `claude-queued` after its run was
    // refused is one no later scheduler run adopts and no person is told about, and one
    // whose mark — if re-applied — walks into the same refusal forever.
    // A LEGACY shadow item wrote its decline back to the issue it named. A marked
    // issue IS the item, so the decline's comment and its `rejected` status already
    // land where the person is looking and there is nothing to mirror (§16.5).
    if (fields.request && fields.request !== item.number) {
      await declineRequest(api, gh, repo, fields.request, item.number, plan.reason);
    }
    // A DECLINE IS A COMPLETED RUN, not a failure: the executor asked, got a
    // no, and closed the occurrence — so the record says `success` and the
    // reason sits beside it in the same comment.
    await close(api, gh, repo, item, STATUS_RUNNING_EXECUTOR, TASK_OBSOLETE, 'not_planned',
      `The precondition declined: ${plan.reason}`
      + (plan.standing
        ? '\n\nThis task\'s next occurrence is decided at its next anchor; declined occurrences are recorded on the schedule board.'
        : ''), 'success');
    return 'obsolete';
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
      // A RUN THAT FAILED PARKS `failure`, whatever the worker asked for (#1452).
      // The marker used to route the park, so a worker naming `action` put a failed
      // run in a NON-BLOCKING lane: the standing slot freed and the task re-filed the
      // next day against a cause nobody had fixed. That is how ClaudiniteCanary
      // reached seven copies of one fleet-digest failure and hitbut twenty-two.
      //
      // The verdict is not discarded — it was always most useful as the human-facing
      // instruction, and that is where it now goes, kind and detail both. A run that
      // never STARTED is the other thing entirely and keeps its own lane: see the
      // `missingSecrets` branch below, where nothing failed because nothing ran.
      await converge(api, gh, repo, item, STATUS_RUNNING_EXECUTOR, NEEDS_HUMAN_FAILURE, claim,
        `Code-work failed: ${result.why}`
        + `${result.triage?.kind ? `\n\nThe worker asks for: **${result.triage.kind}**` : ''}`
        + `${result.triage?.detail ? `\n\nThe worker's own verdict: ${result.triage.detail}` : ''}`
        + `${result.detail ? `\n\n\`\`\`\n${result.detail}\n\`\`\`` : ''}`);
      return 'needs-human';
    }
    if (result.missingSecrets?.length) {
      await converge(api, gh, repo, item, STATUS_RUNNING_EXECUTOR, NEEDS_HUMAN_ACTION, claim,
        `This task declares repo Actions secrets that are not configured: ${result.missingSecrets.join(', ')}. Set them in repo settings and re-queue this item (${requeueHint}).`);
      return 'needs-human';
    }
    if (!result.agentRequested) {
      // A run that deliberately left an UNMERGED PR is not finished, it is waiting
      // on a person — so the item stays OPEN at `task:needs-human-approval` rather
      // than closing as delivered. It does not hold the task's lane while it waits
      // (`isBlockingPark`): the next occurrence is filed on schedule around it, so
      // an unreviewed PR delays nobody but its reviewer.
      if (result.openPr) {
        await converge(api, gh, repo, item, STATUS_RUNNING_EXECUTOR, NEEDS_HUMAN_APPROVAL, claim,
          `Code-work did this run's work and opened a PR for you to approve:\n${result.delivered.map((d) => `- ${d}`).join('\n')}`
          + `\n\nMerge or close #${result.openPr}, then close this item. This task keeps running on schedule meanwhile.`, null);
        return 'needs-human';
      }
      await close(api, gh, repo, item, STATUS_RUNNING_EXECUTOR, TASK_DONE, 'completed',
        result.delivered?.length
          ? `Code-work did this run's work and left:\n${result.delivered.map((d) => `- ${d}`).join('\n')}`
          : 'Code-work did this run\'s work; no agent was needed.', 'success');
      return TASK_DONE;
    }
    return handOff({ api, gh, repo, item, task, id, context, result, executorId, claim, invokeAgent, config, log });
  }

  // An agentless task with no code-work does nothing (the contract forbids it).
  if (task.decl.agent_model === 'none') {
    await converge(api, gh, repo, item, STATUS_RUNNING_EXECUTOR, NEEDS_HUMAN_FAILURE, claim,
      'This task is agentless but declares no code_work, so there is nothing to run — a contract-forbidden shape that reached the queue.', 'invalid');
    return 'needs-human';
  }
  return handOff({ api, gh, repo, item, task, id, context, result: {}, executorId, claim, invokeAgent, config, log });
}

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

// @deprecated The write-back a refused SHADOW item's issue got — one comment saying
// why, and the queued label off, so the request was disarmed rather than left
// looking pending. Nothing writes it for an item filed under the one-issue model,
// where the item and the issue are the same object; it stays for the shadow items
// still draining, whose issue is a different one (DESIGN §16.5).
async function declineRequest(api, gh, repo, request, item, reason) {
  await api.comment(gh, repo, request,
    `Not implementing this: ${reason}\n\nThe queued run (#${item}) is closed and \`${QUEUED_LABEL}\` is removed. `
    + 'If this was wrong, mark the issue again — a request is only run when the person who opened it, or somebody who commented `/claude go`, has push access here.');
  await api.removeLabel(gh, repo, request, QUEUED_LABEL);
}

// @deprecated The roll retired with #1115 — nothing writes this any more. Kept
// exported because bodies the fielded roll wrote are stored data: the
// round-trip test over this writer is what pins `parseLastVerdict`'s decode,
// which the migration and the dashboard still read.
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
  // Every section lands in the machine's half of the body — the whole body for a
  // filed item, the machine block for a marked issue, whose prose is the person's.
  const body = editItemBody(item.body, (machine) => {
    let out = machine;
    if (context.length) out = withSection(out, 'Context', context);
    if (result.delivered?.length) out = withSection(out, DELIVERED_HEADING, result.delivered, LEGACY_DELIVERED_HEADINGS);
    if (result.reason) out = withSection(out, 'Why the agent is here', [result.reason]);
    return out;
  });
  await gh(`/repos/${repo}/issues/${item.number}`, { method: 'PATCH', body: { body } });

  await swapStatus(api, gh, repo, item, STATUS_RUNNING_EXECUTOR, AGENT);
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
    await converge(api, gh, repo, item, STATUS_RUNNING_AGENT, NEEDS_HUMAN_ACTION, claim,
      `Could not start an agent session: ${invocation.error}\n\nNo session was started. Fix the invocation endpoint, then re-queue this item (${requeueHint}).`);
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
    + 'If a session did start it will converge this item; if it did not, the janitor\'s agent leash parks it for a human within a few hours.');
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
  // `item.taskId` is the resolved id — a marked issue's title names no task, so the
  // title parse alone would silently drop the record for every request run.
  const id = item.taskId ?? null;
  const parsed = status
    ? (id ? { pack: id.split('/')[0], task: id.split('/').slice(1).join('/') } : parseWorkItemTitle(item.title))
    : null;
  return parsed
    ? `\n\n\`\`\`\n${renderTaskExec({ pack: parsed.pack, task: parsed.task, slotId: `#${item.number}`, status })}\n\`\`\``
    : '';
};

// Park an item for a human. ONE label: the park IS the status, and its kind is what
// the human is being asked for (DESIGN §4). The two-label park it replaces could be
// half-applied, which was a torn state of its own.
async function converge(api, gh, repo, item, from, park, claim, body, status = 'failed') {
  await strikeClaim(api, gh, repo, claim);
  await api.comment(gh, repo, item.number, body + recordFor(item, status));
  await swapStatus(api, gh, repo, item, from, park);
}

// A close writes only to the item it holds (§15.19, reversed by §15.31 /
// #1373): a dependent this close may make due is released solely by the
// scheduler run's own readiness job, on its next hourly pass, never here.
async function close(api, gh, repo, item, from, outcome, stateReason, body, status) {
  await api.comment(gh, repo, item.number, body + recordFor(item, status));
  await clearStatus(api, gh, repo, item, from);
  await api.addLabel(gh, repo, item.number, outcome);
  // A MARKED ISSUE IS NOT THE RUN'S TO CLOSE (§16.1, §16.5). The item's terminal
  // status stands on the still-open issue: the run's verdict is about the run, and
  // whether the issue is finished belongs to the person who opened it.
  if (!isWorkItemTitle(item.title)) return;
  await api.closeIssue(gh, repo, item.number, stateReason);
}

// --- CLI ----------------------------------------------------------------------

async function main() {
  // THE OPERATOR HOLD, FIRST ACT (§15.24) — before the config load, before the
  // first API call, so a held queue reads nothing and writes nothing rather than
  // deriving the world and then declining to act on it.
  if (isSuspended()) { console.log('## Claudinite executor\n'); console.log(suspendedNotice()); return; }
  const { makeGh, actionRepoContext } = await import('../signals/gh.mjs');
  const { discoverTasks } = await import('../discover.mjs');
  const { loadConfig, isDormant } = await import('../../../engine/checks/helpers/repo-context.mjs');
  const { ensureLabels } = await import('../github.mjs');
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
  await ensureLabels(gh, repo, QUEUE_LABELS);

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
    heldNow: () => readSuspendedNow(gh, repo, { log: console.log }),
  });

  console.log(done.length
    ? done.map((d) => `- #${d.issue}: ${d.outcome}`).join('\n')
    : '- nothing ready to pick up');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
