// The scheduler entrypoint's orchestration core (per-project-scheduling DESIGN
// §3). The vendored hourly Action runs this: decide due slots from the run
// ledger, discover active tasks, collect only the signals the due tasks declare,
// run each precondition, and either dispatch agent work as a `ready-for-agent`
// issue or (for `agent_model: none`) run the worker inline.
//
// This module is the DECISION core, kept injectable so it tests with fakes: the
// GitHub I/O (the Actions run-ledger read for `lastSuccess`, the signal
// collectors, the issue search/create) is supplied by the thin CLI shell around
// `planRun`. The "should this run" verdict is always code here — never the
// shell's judgment (the same split the fleet planner uses).

import { pathToFileURL } from 'node:url';
import { dueSlots, mostRecentSlot } from './slots.mjs';
import {
  planDispatch, dispatchTitle, dispatchBody, DISPATCH_PREFIX, READY_LABEL, NEEDS_HUMAN_LABEL,
  SCHEDULER_LABELS, readyLabelForScope,
} from './dispatch.mjs';
import { isAgentless } from './model-map.mjs';
import { isDormant } from '../checks/helpers/repo-context.mjs';
import { renderTaskRuns } from './run-record.mjs';
import { localSignalContext } from './signals/local.mjs';
import { runPrework, preworkFailure, agentRequestPath, clearAgentRequest, agentRequested, readAgentRequest } from './prework.mjs';

// The due tasks, each paired with the slot it runs under. Union the discovered
// tasks' frequencies, ask slots which are due (run-ledger math), then map due
// frequencies back to their tasks. A task whose frequency isn't due drops out.
export function computeDueTaskSlots(tasks, schedule, now, lastSuccess, forced = []) {
  const frequencies = [...new Set(tasks.map((t) => t.decl.frequency))];
  const due = new Map(dueSlots(frequencies, schedule, now, lastSuccess).map((d) => [d.frequency, d]));
  const out = [];
  for (const task of tasks) {
    const slot = due.get(task.decl.frequency);
    if (slot) { out.push({ task, slotId: slot.slotId, slotTime: slot.slotTime }); continue; }
    // A FORCED task runs under its most-recent slot even though that slot has
    // already been run. This gate is the reason forcing has to live here at all:
    // the due list is computed BEFORE any precondition, so a task whose slot has
    // passed is never looked at again — and a mid-day forced run is the only kind
    // that matters (#515). `planRun` then skips its precondition outright.
    if (forced.includes(task.id)) {
      const s = mostRecentSlot(task.decl.frequency, schedule, now);
      out.push({ task, slotId: s.id, slotTime: s.time, forced: true });
    }
  }
  return out;
}

// The verdict a forced task gets INSTEAD of its precondition. The context line
// is generic on purpose — it names the mechanism, not the task — and it is there
// because a dispatch issue's Context is the agent's binding scope: a forced
// dispatch that carried none would read as a scope of nothing, and the agent
// should know it arrived by a hand-started run rather than a met condition.
const FORCED_VERDICT = Object.freeze({
  run: true,
  reason: 'forced by FORCE_TASKS on a manual scheduler run — its precondition was not evaluated',
  context: Object.freeze(['This run was forced manually (FORCE_TASKS on a workflow_dispatch); the task\'s own precondition was not evaluated, so nothing here asserts there is work to do. Do only what the task file specifies, and converge to a no-op if there is nothing.']),
});

// The task ids a manual run forced, out of the opaque override bag. This is the
// ONE key the engine reads from that bag, and it is deliberately generic: it
// learns "run these task ids", never what any of them do. No task declaration
// mentions forcing, and no precondition is consulted for a forced task — an id
// matching no discovered task simply forces nothing.
export function forcedTaskIds(overrides = {}) {
  return String(overrides.FORCE_TASKS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

// The union of signal names the due tasks declare — the scheduler collects only
// these, so a non-daily slot never pays for daily tasks' signals (DESIGN §3.3).
export function signalsUnion(dueTaskSlots) {
  const names = new Set();
  for (const { task } of dueTaskSlots) for (const name of task.decl.precondition_signals) names.add(name);
  return [...names];
}

// The signal-collection lookback: the widest due task's period plus 1h slack
// (DESIGN §3.3). Stateless fixed lookback — overlap is absorbed by dedupe.
const FREQUENCY_MS = {
  hourly: 3600e3, 'daily-2h': 86400e3, 'daily-1h': 86400e3, daily: 86400e3,
  'daily+1h': 86400e3, weekly: 7 * 86400e3, monthly: 31 * 86400e3,
};
export function windowStart(dueTaskSlots, now) {
  const widest = Math.max(0, ...dueTaskSlots.map(({ task }) => FREQUENCY_MS[task.decl.frequency] ?? 86400e3));
  return new Date(new Date(now).getTime() - widest - 3600e3).toISOString();
}

// Run one task's precondition in isolation (DESIGN §3.4). A throwing
// precondition converges to a skip with the error recorded — it never sinks the
// rest of the run; the CLI escalates a thrown precondition to a workflow-failure
// issue separately.
//
// `exclusive` is the verdict's optional CLAIM ON THE WHOLE RUN (see planRun): a
// task saying "if I run, I run alone this cycle". Normalized to a boolean here,
// like every other field, so a precondition that omits it is simply not claiming.
export function runPrecondition(task, signals, packConfig) {
  try {
    const v = task.decl.precondition(signals, packConfig) ?? {};
    return {
      run: v.run === true,
      exclusive: v.exclusive === true,
      reason: v.reason ?? '',
      context: Array.isArray(v.context) ? v.context : [],
    };
  } catch (e) {
    return { run: false, exclusive: false, reason: `precondition threw: ${e.message}`, context: [], error: e.message };
  }
}

// What a task deferred by another task's exclusive claim is told, in the run
// summary and the run record. Generic on purpose — it names the claimant, never
// what the claimant does, because the engine does not know.
//
// "Its next slot", not "the next run": due-ness is `slotTime ∈ (lastSuccess,
// now]` and this run succeeds, so the watermark moves past the slot that was
// deferred. A deferred daily task runs tomorrow, a weekly one next week. That is
// the price of the claim and it is stated where a person reading the run sees it.
export const deferredByClaim = (claimants) =>
  `deferred — ${claimants.join(', ')} claimed this run exclusively; this slot is spent, the task runs again at its next slot`;

// A human-readable job-summary line per evaluated task — the observability the
// old plan.json gave (DESIGN §3.6).
export function renderSummary(evaluations) {
  return evaluations.map((e) => {
    const verb = !e.run ? 'skip' : e.deferred ? 'defer' : e.inline ? 'run-inline' : e.dispatch?.action ?? 'run';
    const forced = e.forced ? ' (forced)' : '';
    const claim = e.exclusive ? ' (exclusive)' : '';
    return `- ${e.pack}/${e.task} [${e.slotId}]${forced}${claim} ${verb} — ${e.deferred || e.reason || e.dispatch?.reason || ''}`.trimEnd();
  }).join('\n');
}

// Orchestrate one scheduler run into a set of decisions — the reusable core the
// CLI wraps with real GitHub I/O. Injected seams:
//   collectSignals(names) -> signals object (the declared union, collected once)
//   packConfigFor(packId) -> that pack's entry config from .claudinite-checks.json
//   existingIssuesFor(pack, task) -> the task family's issues [{number,title,state}]
// Returns `{ evaluations }`: one record per due task with its precondition
// verdict and, when it runs, either an inline marker (agent_model: none) or a
// dispatch decision (planDispatch).
//
// DORMANCY IS THE FIRST GATE, ahead of the due-slot math and every task's own
// precondition (`config`, the repo's loaded declaration). A dormant project has
// said it is out of the recurring work: it is not that each task happens to have
// nothing to do, it is that no task is asked. Putting the gate here rather than
// in each precondition is the whole point — every task, canon and local, present
// and future, is covered by one decision nothing has to opt into, and a task
// never learns that dormancy exists.
//
// THE EXCLUSIVE CLAIM (owner, 2026-08-01). A precondition may return `exclusive: true`
// alongside `run: true`: "if I run this cycle, I run ALONE". Every other due task
// whose precondition also said run is deferred — no prework, no dispatch
// issue, no inline work — and the run does that one task's work and nothing else.
//
// This exists because the hourly cron is not hourly (github-actions-scheduling:
// GitHub drops and delays scheduled fires freely). The daily anchors stage the
// nightly chain by an HOUR each — baselining at 02:00 converges the mount before
// the 03:00 and 04:00 tasks read it — and that staging holds only while the fires
// land roughly on time. A run that fires at 05:40 after three dropped fires finds
// all four daily slots due at once and dispatches them together, so the task whose
// whole job is to repair what the others run against runs BESIDE them instead of
// before them. The claim restores the ordering the anchors were meant to express,
// on exactly the runs where the anchors failed to.
//
// It is deliberately a task's decision and not the engine's: the engine learns
// "this verdict claims the run", never which task claims or why — the same
// separation `forcedTaskIds` keeps, and the reason nothing here mentions
// baselining. A task that never returns `exclusive` cannot be affected as a
// claimant, only as a deferree.
//
// A FORCED task is exempt from deferral (and cannot claim: FORCED_VERDICT carries
// no `exclusive`). Forcing is an operator decision already made on a hand-started
// run; a claim silently swallowing the task the operator asked for would make that
// run do nothing it was started for.
export async function planRun({
  tasks, schedule, now, lastSuccess, overrides = {}, config = {}, runId = null,
  collectSignals, packConfigFor = () => ({}), existingIssuesFor = async () => [],
}) {
  if (isDormant(config)) return { evaluations: [], dormant: true };
  // `overrides` arrives as a parameter rather than out of `signals` because the
  // due list is what decides which signals get collected — the bag has to be
  // known before the collection it would otherwise be part of.
  const dueList = computeDueTaskSlots(tasks, schedule, now, lastSuccess, forcedTaskIds(overrides));
  const signals = await collectSignals(signalsUnion(dueList));

  // Pass 1 — every due task's verdict, and nothing else. Preconditions are pure
  // and cheap, and a claim is only knowable once they have ALL spoken, so no
  // issue search and no dispatch decision may happen before this pass completes.
  //
  // A FORCED task does not consult its precondition at all. "Forced" is a
  // decision the operator already made, so asking the task whether it agrees is
  // both redundant and a way for the answer to be no — and a task that could
  // veto a force would need to know forcing exists, which is exactly the
  // coupling this mechanism avoids. Nothing in a task declaration mentions
  // forcing; the engine owns it end to end.
  const verdicts = dueList.map(({ task, slotId, forced }) => ({
    task, slotId, forced,
    pre: forced ? FORCED_VERDICT : runPrecondition(task, signals, packConfigFor(task.pack)),
  }));

  // The claimants: running tasks that asked for the run to themselves. More than
  // one is not a conflict to arbitrate — they all run and everything else defers,
  // which is the only reading that needs no priority order between packs.
  const claimants = verdicts.filter((v) => v.pre.run && v.pre.exclusive).map((v) => `${v.task.pack}/${v.task.id}`);

  const evaluations = [];
  for (const { task, slotId: dueSlot, forced, pre } of verdicts) {
    // A FORCED dispatch carries a per-run marker in its slot id. The exactly-once
    // guard keys on the (task, slot) title, and a forced run's whole point is to
    // re-run a slot the schedule already ran — without the marker, planDispatch's
    // state=all title match silently skipped exactly the dispatch the operator
    // asked for. The marker keeps every title unique and every record attributable
    // to the hand-started run that caused it. At-most-one-open still applies: a
    // forced run never stacks a second dispatch on one that is still open.
    const slotId = forced && runId !== null ? `${dueSlot}~f${runId}` : dueSlot;
    const rec = {
      pack: task.pack, task: task.id, slotId,
      model: task.decl.agent_model, outcome: task.decl.expected_outcome,
      run: pre.run, reason: pre.reason, context: pre.context,
    };
    if (forced) rec.forced = true;
    if (pre.error) rec.error = pre.error;
    if (pre.run) {
      if (pre.exclusive) rec.exclusive = true;
      // Deferred by someone else's claim: the record keeps `run: true` (its
      // precondition DID say there was work) and carries no dispatch, no inline
      // and no prework flag, so every actor downstream — the CLI action
      // loop, the run record, the summary — reads it as work that was wanted and
      // did not happen, not as a skip.
      if (claimants.length && !pre.exclusive && !forced) {
        rec.deferred = deferredByClaim(claimants);
        evaluations.push(rec);
        continue;
      }
      // Declared prework runs as a subprocess BEFORE the agentic phase
      // (DESIGN §3) — flagged here (pure) for the summary; the CLI shell executes
      // it. An agentless task is prework-only; an agentful one hands off to
      // the agentic phase after prework succeeds.
      if (task.decl.prework) rec.prework = true;
      if (isAgentless(task.decl.agent_model)) {
        // agent_model: none — no agent and no dispatch issue on success. A task with
        // no prework runs the legacy inline worker; with prework it is
        // the subprocess above.
        rec.inline = true;
      } else {
        const existing = await existingIssuesFor(task.pack, task.id);
        // Route the dispatch by the task's (deprecated, lingering) session_scope —
        // absent on everything but the canon's curation tasks, so almost every
        // dispatch rides the ordinary ready label.
        const readyLabel = readyLabelForScope(task.decl.session_scope);
        rec.dispatch = planDispatch({ existing, pack: task.pack, task: task.id, slotId, readyLabel });
      }
    }
    evaluations.push(rec);
  }
  return { evaluations };
}

// The opaque override bag a MANUAL run may carry (`workflow_dispatch` input →
// `CLAUDINITE_OVERRIDES`). GitHub cannot declare arbitrary named inputs, so the
// workflow takes ONE free-form string and this splits it into keys.
//
// Exactly one key is understood: `FORCE_TASKS` (see `forcedTaskIds`), and it is
// understood GENERICALLY — "run these task ids", never what any of them do. No
// task declaration mentions forcing and no precondition is consulted for a forced
// task, so the scheduler never learns what baselining is and baselining never
// learns that forcing exists. Anything else in the bag is parsed and ignored,
// which is what leaves room for a future override without a schema.
//
// `A=1,B=2`, newline-separated, or bare `A` (⇒ `'true'`). Values stay STRINGS with
// no truthiness coercion: a task compares against the literal it documents, so
// `FORCE_X=false` can never read as "the key is present, therefore on".
export function parseOverrides(raw) {
  const out = {};
  for (const part of String(raw ?? '').split(/[,\n]/)) {
    const token = part.trim();
    if (!token) continue;
    const eq = token.indexOf('=');
    if (eq === -1) out[token] = 'true';
    else out[token.slice(0, eq).trim()] = token.slice(eq + 1).trim();
  }
  return out;
}

// The `ctx` every signal collector reads (DESIGN §3.3) — the already-resolved
// facts a collector may not go and fetch for itself, built once per run and
// handed to `collectSignals`. Exported so the construction itself is testable:
// the collectors' `ctx.X ?? null` seam makes them unit-testable with a hand-built
// ctx, which is exactly why a key nothing here populates can read as "collector
// works" forever. Assert against THIS, not a hand-built shape.
// `root` is the Action-side checkout: the manifest version, the local-pack
// presence and the configured retention are all read from it (signals/local.mjs),
// because a scheduled run already has the tree on disk and an API round-trip
// would buy nothing.
export function buildSignalContext({ root, repo, defaultBranch, now, sinceIso, config, fleet = null, packConfigFor = () => ({}) }) {
  const local = localSignalContext(root, { packIds: config.packs ?? [], packConfigFor });
  return {
    repo, defaultBranch, now, sinceIso, config,
    activePacks: config.packs, fleet,
    manifestVersion: local.manifestVersion,
    hasLocalPacks: local.hasLocalPacks,
    retentionDays: local.retentionDays,
  };
}

// --- CLI: the thin I/O shell the vendored workflow invokes -------------------
// Wires the run-ledger read, signal collectors, and issue I/O around planRun,
// then acts on each decision (file a labeled dispatch issue, or run an inline
// worker) and prints the job summary. All GitHub access here is the Action's
// GITHUB_TOKEN — the one sanctioned non-MCP surface (DESIGN §10).

// The task family's issues (state=all) via the search API, filtered to exact
// prefix — the input planDispatch's exactly-once / at-most-one-open guards read.
async function existingIssuesViaSearch(gh, repo, pack, task) {
  const q = encodeURIComponent(`repo:${repo} in:title "${DISPATCH_PREFIX} ${pack}/${task}"`);
  const { status, json } = await gh(`/search/issues?q=${q}&per_page=100`);
  if (status !== 200 || !Array.isArray(json?.items)) return [];
  const prefix = `${DISPATCH_PREFIX} ${pack}/${task} `;
  return json.items
    .filter((i) => `${(i.title ?? '').trim()} `.startsWith(prefix))
    .map((i) => ({ number: i.number, title: i.title, state: i.state }));
}

// DISPATCH-ISSUE MAINTENANCE DOES NOT LIVE HERE (owner, 2026-08-06). The
// scheduler CREATES task issues and nothing else about their afterlife: the
// stale-escalation, dead-claim and re-arm recovery that used to run as a pass at
// the end of every scheduler run is a third, separate JANITOR responsibility —
// an ordinary daily task on this same machinery (the engine does not know which
// pack carries it, same as every task). Scheduler creates, executor executes its
// one issue, janitor cleans up and assesses health. The pure rules stay in
// dispatch.mjs; the janitor's worker is the only I/O shell over them.

// Ensure the dispatch labels exist before any is applied — GitHub 422s when you
// apply an unknown label (it never creates one on demand), so the scheduler, as the
// thing that assigns them, guarantees them here. Idempotent (201 created / 422 already
// exists are both success) and self-healing (a deleted label reappears next run), which
// is why no separate one-off label-creation step is needed. Exported for the run tests.
export async function ensureLabels(gh, repo, labels) {
  for (const { name, color, description } of labels) {
    const res = await gh(`/repos/${repo}/labels`, { method: 'POST', body: { name, color, description } });
    if (res.status === 201) continue;                       // created to spec — nothing further
    if (res.status === 422) {
      // The NAME is taken; that says nothing about the colour or description. A
      // label GitHub auto-created (applying an unknown name to an issue mints it
      // grey `ededed`, no description) would keep those defaults for good, because
      // POST 422s forever. So reconcile the shape, not just the existence — that
      // is what makes the self-healing claim above true for drift and not only for
      // deletion. PATCH is idempotent: an already-correct label is a no-op write.
      const fix = await gh(`/repos/${repo}/labels/${encodeURIComponent(name)}`, {
        method: 'PATCH', body: { color, description },
      });
      if (fix.status !== 200) console.log(`! could not reconcile label "${name}": ${fix.status}`);
      continue;
    }
    console.log(`! could not ensure label "${name}": ${res.status}`);
  }
}

async function main() {
  const { makeGh, lastSuccessTime, actionRepoContext } = await import('./signals/gh.mjs');
  const { collectSignals } = await import('./signals/index.mjs');
  const { discoverTasks } = await import('./discover.mjs');
  const { loadConfig } = await import('../checks/helpers/repo-context.mjs');

  const root = process.cwd();
  const { repo, defaultBranch } = actionRepoContext();
  if (!repo) { console.error('GITHUB_REPOSITORY not set — not in an Actions context'); process.exit(1); }
  const gh = makeGh();
  const config = loadConfig(root);

  // The dormancy gate, before ANY of it: the run-ledger read, the task discovery,
  // the signal collection, the issue I/O, the dispatch maintenance. planRun holds
  // the same verdict (one predicate, both call sites) and would return an empty
  // plan — but a dormant repo should not pay for the reads that produce it, and
  // the maintenance pass below writes to issues, which is exactly the ceremony
  // dormancy exists to stop.
  //
  // Exit 0, deliberately. The run enters the success ledger and the watermark
  // advances past these slots, so waking a project up does NOT replay the months
  // it slept through — it simply starts scheduling again from now. Slots skipped
  // while dormant are skipped on purpose, not deferred.
  if (isDormant(config)) {
    console.log('## Claudinite scheduler\n');
    console.log('- this project declares itself dormant ("dormant": true in .claudinite-checks.json) — no tasks evaluated, no work dispatched');
    return;
  }

  const { tasks, errors } = await discoverTasks(root, config);
  for (const e of errors) console.log(`! ${e.what}`);

  const now = new Date();
  // The watermark IS the scheduler's state, so a run that cannot read it cannot
  // compute due-ness at all — and every guess is wrong in a way nobody sees:
  // "assume fresh" re-fires the first-run set on a mature repo, "assume now"
  // silently eats the slots it skipped. Fail the run instead. It must exit
  // NON-ZERO: an exit-0 abort would enter the success ledger and advance the
  // watermark past the very slots it declined to evaluate. Failing leaves the
  // watermark untouched, so the next successful run catches them up (#522).
  let lastSuccess;
  try {
    lastSuccess = await lastSuccessTime(gh, repo);
  } catch (e) {
    console.error(`${e.message} — cannot compute due slots; failing this run so the next one catches up`);
    process.exit(1);
  }
  const schedule = config.taskScheduler;

  const due = computeDueTaskSlots(tasks, schedule, now, lastSuccess);
  const sinceIso = windowStart(due, now);

  // The fleet aggregate (canon-only, DESIGN §3.3) is expensive — a full
  // enumeration over the fleet PAT — so build it ONLY when a due task actually
  // declares the `fleet` signal, and only when FLEET_GITHUB_TOKEN is set (the
  // canon repo with the census credential). Otherwise ctx.fleet stays null and
  // the collector returns null, so a fleet task's precondition skips rather than
  // crashes. Enumeration failures are surfaced by readFleet as `{ error }`, not
  // thrown — a fleet task treats that as "no work I can prove".
  let fleet = null;
  if (signalsUnion(due).includes('fleet')) {
    const { readFleet, makeFleetGh } = await import('./signals/fleet.mjs');
    const fleetGh = makeFleetGh();
    if (fleetGh) {
      const owner = repo.split('/')[0];
      fleet = await readFleet(fleetGh, { owner, canonRepo: repo, sinceIso });
      if (fleet.error) console.log(`! fleet enumeration: ${fleet.error}`);
    } else {
      console.log('- a due task declares the `fleet` signal but FLEET_GITHUB_TOKEN is not set — skipping fleet-scoped tasks');
    }
  }

  const packConfigFor = (packId) => config.packConfig?.[packId] ?? {};

  // An override only ever arrives on a hand-started run, and it makes a task run
  // that its own precondition would have skipped — so say so in the log. An
  // unattended system that can be forced silently is one whose run history stops
  // explaining itself.
  const overrides = parseOverrides(process.env.CLAUDINITE_OVERRIDES);
  const overrideKeys = Object.keys(overrides);
  if (overrideKeys.length > 0) {
    console.log(`- manual run overrides: ${overrideKeys.map((k) => `${k}=${overrides[k]}`).join(', ')}`);
  }

  const ctx = buildSignalContext({
    root, repo, defaultBranch, now: now.toISOString(), sinceIso, config, fleet, packConfigFor,
  });

  const { evaluations } = await planRun({
    tasks, schedule, now, lastSuccess, overrides, config,
    // The per-run marker a FORCED dispatch's slot id carries (see planRun) —
    // the Actions run id, unique per hand-started run by the platform.
    runId: process.env.GITHUB_RUN_ID ?? null,
    collectSignals: (names) => collectSignals(gh, ctx, names),
    packConfigFor,
    existingIssuesFor: (pack, task) => existingIssuesViaSearch(gh, repo, pack, task),
  });

  // An exclusive claim makes this run do ONE task's work and defer the rest, so
  // say so before the actions rather than leaving it to be inferred from the
  // per-task summary lines. An unattended run that quietly drops work it was
  // going to do is one whose history stops explaining itself.
  const claimed = evaluations.filter((r) => r.exclusive);
  const deferred = evaluations.filter((r) => r.deferred);
  if (claimed.length) {
    console.log(`- ${claimed.map((r) => `${r.pack}/${r.task}`).join(', ')} claimed this run exclusively`
      + ` — ${deferred.length} other due task(s) deferred to their next slot`);
  }

  // Guarantee the dispatch labels exist before we file any labeled issue — when a
  // task will dispatch OR will run prework (which may converge to
  // needs-human). An idle run pays nothing.
  const labelsEnsured = evaluations.some((r) => r.run && (r.prework || (!r.inline && r.dispatch?.action === 'create')));
  if (labelsEnsured) await ensureLabels(gh, repo, SCHEDULER_LABELS);

  // File the labeled hand-off issue the executor runs (READY_LABEL): first line is
  // the task path, body carries the precondition's binding Context (dispatch.mjs).
  const fileHandoff = async (rec, taskObj) => {
    const title = dispatchTitle({ pack: rec.pack, task: rec.task, slotId: rec.slotId });
    const body = dispatchBody({
      taskPath: taskObj.taskPath, pack: rec.pack, task: rec.task, slotId: rec.slotId,
      context: rec.context,
      // What prework made, by identity — the agent's only source for it.
      delivered: rec.delivered,
      // …and which of its escalation conditions woke the agent, so the agent does not
      // have to re-derive that from the repo (and get it wrong).
      reason: rec.escalationReason,
    });
    // The scope-resolved ready label (self vs fleet) from planDispatch — the
    // executor routine wired to it runs the task.
    const readyLabel = rec.dispatch?.label ?? READY_LABEL;
    const res = await gh(`/repos/${repo}/issues`, { method: 'POST', body: { title, body, labels: [readyLabel] } });
    if (res.status >= 300) console.log(`! failed to file dispatch issue for ${rec.pack}/${rec.task}: ${res.status}`);
  };

  // Converge a failed prework run to a single open needs-human issue for the
  // family — at-most-one-open, so a repeatedly-failing task never spams issues.
  const fileNeedsHuman = async (rec, why, extra) => {
    const existing = await existingIssuesViaSearch(gh, repo, rec.pack, rec.task);
    if (existing.some((i) => i.state === 'open')) {
      console.log(`  (an open dispatch issue already covers ${rec.pack}/${rec.task} — not filing another)`);
      return;
    }
    const title = dispatchTitle({ pack: rec.pack, task: rec.task, slotId: rec.slotId });
    const body = [
      `Prework for \`${rec.pack}/${rec.task}\` (slot \`${rec.slotId}\`) failed and needs human triage.`,
      '', `- ${why}`, ...extra.map((e) => `- ${e}`),
    ].join('\n') + '\n';
    const res = await gh(`/repos/${repo}/issues`, { method: 'POST', body: { title, body, labels: [NEEDS_HUMAN_LABEL] } });
    if (res.status >= 300) console.log(`! failed to file needs-human issue for ${rec.pack}/${rec.task}: ${res.status}`);
  };

  for (const rec of evaluations) {
    // `deferred` — another task claimed this run exclusively. The record says the
    // precondition wanted work; this is the one place that decides none of it
    // happens, so nothing below (prework subprocess, dispatch issue) runs.
    if (!rec.run || rec.deferred) continue;
    const taskObj = tasks.find((t) => t.pack === rec.pack && t.id === rec.task);
    const decl = taskObj.decl;

    // Phase 1 — prework (DESIGN §3): run the declared command as a subprocess
    // bounded by its timeout, before the agentic phase. Its cwd is the task dir;
    // the repo root + slot context ride in via CLAUDINITE_* env.
    if (rec.prework) {
      // A per-run signal path the worker writes to REQUEST the agent stage
      // (conditional handoff, §3). Clear any stale one first so a prior run can't
      // spuriously escalate this one.
      const requestPath = agentRequestPath(rec);
      clearAgentRequest(requestPath);
      // The child's own output is echoed live inside a collapsible Actions group, so
      // the run log says what the worker did instead of only whether it exited zero.
      // Grouped because several tasks can run prework in one run and their output would
      // otherwise interleave into one unattributable wall; live because a worker killed
      // at its timeout takes any buffered output with it.
      console.log(`::group::prework ${rec.pack}/${rec.task} [${rec.slotId}]`);
      const result = await runPrework(decl.prework, {
        taskDir: taskObj.taskDir,
        env: {
          ...process.env,
          CLAUDINITE_REPO_ROOT: root,
          CLAUDINITE_REPO: repo,
          CLAUDINITE_DEFAULT_BRANCH: defaultBranch ?? '',
          CLAUDINITE_SLOT_ID: rec.slotId,
          CLAUDINITE_PACK: rec.pack,
          CLAUDINITE_TASK: rec.task,
          CLAUDINITE_REQUEST_AGENT: requestPath,
        },
        timeoutSeconds: decl.prework_timeout,
      });
      console.log('::endgroup::');
      rec.preworkResult = { ok: result.ok, timedOut: result.timedOut, code: result.code };
      if (!result.ok) {
        const why = preworkFailure(result);
        console.log(`! prework ${rec.pack}/${rec.task} [${rec.slotId}]: ${why}`);
        const extra = result.stderr?.trim() ? [`stderr tail: ${result.stderr.trim().split('\n').slice(-3).join(' / ')}`] : [];
        // Repeat the tail OUTSIDE the group: Actions renders a group collapsed, so a
        // failure whose only evidence sits inside one still reads as unexplained.
        for (const line of extra) console.log(`  ${line}`);
        await fileNeedsHuman(rec, why, extra);
        clearAgentRequest(requestPath);
        continue; // never hand off to the agentic phase after failed prework
      }
      // Success. An agentless task is done (no issue on success, as the old inline
      // was quiet). An agentful one hands off ONLY when the worker requested the
      // agent (conditional escalation, §3): a task that absorbs its work into
      // prework stays quiet on the nights nothing needs judgment.
      const requested = agentRequested(requestPath);
      // Read the payload BEFORE clearing: the artifacts this run created and the
      // condition that woke the agent, which the dispatch issue records so the agent
      // never has to search for them by name or re-derive why it is there. Both are
      // null for a worker that named neither — absence is reported as absence.
      const payload = requested ? readAgentRequest(requestPath) : null;
      rec.delivered = payload?.delivered ?? null;
      rec.escalationReason = payload?.reason ?? null;
      clearAgentRequest(requestPath);
      rec.agentRequested = requested;
      console.log(`prework ${rec.pack}/${rec.task} [${rec.slotId}]: ok${rec.inline ? '' : requested ? ' (agent requested)' : ' (no agent needed)'}`);
      if (rec.inline) continue;
      if (requested && rec.dispatch?.action === 'create') await fileHandoff(rec, taskObj);
      continue;
    }

    // No prework. An agentless task with no prework does nothing — the
    // contract now forbids it (agent_model:none REQUIRES prework, so
    // the in-process inline worker path is retired, DESIGN §4). Defensive no-op
    // should one slip past validation.
    if (rec.inline) {
      console.log(`- ${rec.pack}/${rec.task}: agentless with no prework — nothing to run (contract-forbidden)`);
      continue;
    }
    // Agentic task with no prework → today's immediate labeled dispatch.
    if (rec.dispatch?.action === 'create') await fileHandoff(rec, taskObj);
  }

  console.log('## Claudinite scheduler\n');
  console.log(renderSummary(evaluations) || '- no tasks due');

  // The machine-readable half of the same story (run-record.mjs): one line per due
  // task saying what this run DID with it — dispatched an agent, ran it as
  // ran prework only, skipped it on its precondition, failed it, or deferred it.
  // Printed AFTER the action loop, so each line reports what happened rather than
  // what was planned, and read back by the usage fold to count task invocations.
  // Nothing else in the scheduler depends on it: this is a record, not a signal.
  if (evaluations.length) console.log(`\n${renderTaskRuns(evaluations)}`);
}

// Run only when invoked directly (the workflow's `node run.mjs`), never on import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
