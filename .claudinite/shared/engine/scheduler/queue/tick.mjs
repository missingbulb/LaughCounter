// The generator tick (tasks-dispatch DESIGN §5) — a pure function of the clock
// and the issue list, and the whole of the queue's scheduled machinery.
//
// Three jobs, all deterministic label mechanics: INSTANTIATE each recurring
// task's standing item when its anchor comes, READY blocked items whose
// dependencies have resolved and whose not-before has passed, and RECLAIM dead
// executor claims. It evaluates NO precondition and collects NO signal — the
// verdict happens once per period, at pickup, on the executor (§6.4) — which is
// what deletes the run-ledger watermark the slot machinery needed.
//
// `planTick` is the decision core, kept injectable so it tests with fixtures; the
// CLI shell below wires the GitHub reads and applies the ops.

import { pathToFileURL } from 'node:url';
import { mostRecentAnchor, nextAnchor } from './anchors.mjs';
import { EXECUTING_LEASH_MS } from './leases.mjs';
import {
  WORK_PREFIX, BLOCKED, READY, EXECUTING, AGENT, ORIGIN_SCHEDULE, NEEDS_HUMAN, OUTCOME_OBSOLETE,
  QUEUE_LABELS, EPISODE_MARKER, workItemTitle, parseWorkItemTitle, parseWorkItemBody,
  workItemBody, labelNames, hasLabel,
} from './work-item.mjs';

// The tick owns the executing-leash reclaim because it is deterministic and
// hourly, which recovers a dead executor's item in ~2h rather than the janitor's
// ~25h (DESIGN §11, owner decision 6).
export { EXECUTING_LEASH_MS };

const ms = (t) => (t == null ? null : new Date(t).getTime());

// The ops `planTick` emits, each a label-and-body mechanic the shell applies:
//   { kind: 'dedupe',  issue, reason }            close, outcome:obsolete
//   { kind: 'create',  pack, task, labels, body } a task's standing item
//   { kind: 'ready',   issue }                    task:blocked -> task:ready
//   { kind: 'reclaim', issue, reason }            task:executing -> task:ready
//
// `items` is every `[claudinite-work]` issue the shell fetched (state=all for the
// scheduled families, open for the rest), each `{ number, title, body, state,
// labels, created_at, closed_at, updated_at }`. `stateOf(number)` answers the
// state of a `Blocked-by` target that may not be a work item at all; an unknown
// number is never treated as closed, so an unreadable blocker delays rather than
// releases (the convergence-not-prevention posture).
export function planTick({
  tasks, items = [], now, schedule, executingLeashMs = EXECUTING_LEASH_MS,
  stateOf = () => null,
}) {
  const nowMs = ms(now);
  const ops = [];
  const closedByThisTick = new Set();

  // ---- job 1: instantiate — calendar-only, no preconditions, no signals ----
  for (const task of tasks) {
    if (task.decl.frequency === 'manual') continue;
    const title = workItemTitle({ pack: task.pack, task: task.id });
    // The family is title-EXACT (no qualifier) and `origin:schedule` only, so
    // ad-hoc and fan-out items neither suppress nor consume an occurrence (§3).
    const family = items.filter((i) => (i.title ?? '').trim() === title && hasLabel(i, ORIGIN_SCHEDULE));
    const open = family
      .filter((i) => i.state === 'open' && !closedByThisTick.has(i.number))
      .sort((a, b) => a.number - b.number);

    // F16 self-heal, FIRST: nothing documents that a REST list from another node
    // sees a creation seconds old, so a stale list can let a duplicate standing
    // item through. Assume it will happen rather than that it won't — close every
    // open family item but the oldest. Serialized by the tick's concurrency group,
    // so this can never race itself.
    for (const dup of open.slice(1)) {
      closedByThisTick.add(dup.number);
      ops.push({
        kind: 'dedupe', issue: dup.number, pack: task.pack, task: task.id,
        reason: `a duplicate standing item for ${task.pack}/${task.id} — #${open[0].number} is this task's standing item`,
      });
    }
    if (open.length) continue; // the standing item already exists

    const anchor = mostRecentAnchor(task.decl.frequency, schedule, now);
    const anchorMs = anchor.getTime();
    // The occurrence guard has TWO halves (F13): an item CREATED at-or-after the
    // anchor covers this occurrence — and so does an item CLOSED at-or-after it,
    // because a rolled item created in an earlier period that ran and closed today
    // consumed today's occurrence. With the created_at half alone, the very next
    // tick after such a close creates a second item for the same occurrence: a
    // double execution.
    const covered = family.some((i) =>
      (ms(i.created_at) ?? -Infinity) >= anchorMs || (ms(i.closed_at) ?? -Infinity) >= anchorMs);
    if (covered) continue;

    // A brand-new task's FIRST item is born blocked until its NEXT real anchor, so
    // adoption never fires weekly or monthly work off-anchor on the least-proven
    // repo (S25). Everything after that is born ready.
    const firstEver = family.length === 0;
    const notBefore = firstEver ? nextAnchor(task.decl.frequency, schedule, now).toISOString() : null;
    ops.push({
      kind: 'create', pack: task.pack, task: task.id, title,
      labels: [ORIGIN_SCHEDULE, firstEver ? BLOCKED : READY],
      body: workItemBody({
        taskPath: task.taskPath,
        notBefore,
        context: firstEver
          ? [`This task's first work item on this repo — born blocked until its first real anchor (${notBefore}), so adoption never runs it off-anchor.`]
          : [],
      }),
      notBefore,
    });
  }

  // ---- job 2: ready whatever is due (any origin) --------------------------
  for (const item of items) {
    if (item.state !== 'open' || closedByThisTick.has(item.number)) continue;
    if (!hasLabel(item, BLOCKED) || hasLabel(item, NEEDS_HUMAN)) continue;
    const { notBefore, blockedBy } = parseWorkItemBody(item.body);
    const blockersDone = blockedBy.every((n) => stateOf(n) === 'closed');
    const timeReached = notBefore === null || nowMs >= ms(notBefore);
    if (blockersDone && timeReached) ops.push({ kind: 'ready', issue: item.number });
  }

  // ---- job 3: reclaim dead executor claims (DESIGN §11) -------------------
  const policyOf = new Map(tasks.map((t) => [`${t.pack}/${t.id}`, t.decl.on_interrupt ?? 'requeue']));
  for (const item of items) {
    if (item.state !== 'open' || !hasLabel(item, EXECUTING)) continue;
    const silentFor = nowMs - (ms(item.updated_at) ?? ms(item.created_at) ?? nowMs);
    if (silentFor < executingLeashMs) continue;
    const parsed = parseWorkItemTitle(item.title);
    const minutes = Math.round(executingLeashMs / 60e3);
    // `on_interrupt: 'needs-human'` is the at-most-once dial: a task that cannot
    // promise a safe re-run is not re-queued by a recovery path — it goes to a
    // human, who decides whether the interrupted run left anything behind.
    const oneShot = parsed && policyOf.get(`${parsed.pack}/${parsed.task}`) === 'needs-human';
    ops.push({
      kind: 'reclaim', issue: item.number, to: oneShot ? NEEDS_HUMAN : READY,
      reason: oneShot
        ? `The executor holding this item went silent for over ${minutes} minutes. This task declares \`on_interrupt: 'needs-human'\`, so nothing re-queues it automatically — check whether the interrupted run left anything behind, then re-queue it by hand.`
        : `Reclaimed: the executor holding this item went silent for over ${minutes} minutes. Returning it to the queue.`,
    });
  }

  return { ops };
}

// --- the forced wake (DESIGN §8) ----------------------------------------------

// Which standing items a `wake` dispatch names. Forcing a scheduled task IS waking
// its standing item, and this is that same lever reached from OUTSIDE the repo: the
// fleet enforcer dispatches this workflow with the task ids it wants run now, and
// the member wakes its own items with its own token. The enforcer therefore needs
// no issue access anywhere — the fan-out model the sheepdog pack is built on, where
// the enforcer dispatches and the member executes.
//
// An id is `pack/task` or a bare `task` resolved against this repo's own discovered
// tasks, so a caller spanning many members never has to know any one member's pack
// layout. Every id that matches nothing comes back in `unmatched`: a force whose
// report counts only what it woke reads as coverage it did not have.
//
// An item already in flight (`task:ready`, `task:executing`, `task:agent`) is left
// alone and reported as `already`, never re-woken — an episode boundary dropped on
// a live claim is exactly the livelock F18 describes.
export function planWake(spec, tasks = [], items = []) {
  const ids = String(spec ?? '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  const wake = []; const already = []; const unmatched = [];
  for (const id of ids) {
    const [a, b] = id.includes('/') ? id.split('/') : [null, id];
    const owners = tasks.filter((t) => t.id === b && (a === null || t.pack === a));
    if (owners.length !== 1) {
      unmatched.push({ id, why: owners.length ? `${owners.length} declared packs own a "${b}" task — name it as pack/task` : 'no declared pack owns a task by that name' });
      continue;
    }
    const { pack, id: task } = owners[0];
    const item = items.find((i) => {
      if (i.state !== 'open') return false;
      const parsed = parseWorkItemTitle(i.title);
      return parsed && parsed.pack === pack && parsed.task === task;
    });
    if (!item) { unmatched.push({ id, why: `no open standing item for ${pack}/${task}` }); continue; }
    if (IN_FLIGHT.some((l) => hasLabel(item, l))) { already.push({ id, issue: item.number }); continue; }
    wake.push({ id: `${pack}/${task}`, issue: item.number });
  }
  return { wake, already, unmatched };
}

// The states that mean someone already holds this item. `task:agent` counts: the
// work is with a session, and waking would hand a second executor the same item.
const IN_FLIGHT = [READY, EXECUTING, AGENT];

// --- CLI: the thin I/O shell the vendored tick workflow invokes ---------------
// Reads the work-item list, plans, applies. All GitHub access is the Action's
// GITHUB_TOKEN. Dormancy is the first gate, before any read — a project that has
// said it is out of the recurring work should not pay for the list that proves it.

// Every `[claudinite-work]` issue, state=all, via the ISSUES list API — never the
// search index (S6/F11: search is eventually consistent, and a family list that
// misses a just-created item mints a duplicate standing item). Bounded by the
// scheduled families' need for closed history: closed items are only interesting
// back to the widest period, so the listing stops once it is past that.
export async function listWorkItems(gh, repo, { since = null } = {}) {
  const out = [];
  for (let page = 1; ; page += 1) {
    const q = `state=all&sort=created&direction=desc&per_page=100&page=${page}`
      + (since ? `&since=${encodeURIComponent(since)}` : '');
    const { status, json } = await gh(`/repos/${repo}/issues?${q}`);
    if (status !== 200 || !Array.isArray(json) || json.length === 0) break;
    for (const i of json) {
      if (i.pull_request) continue;
      if (!(i.title ?? '').startsWith(WORK_PREFIX)) continue;
      out.push({
        number: i.number, title: i.title, body: i.body ?? '', state: i.state,
        labels: labelNames(i), created_at: i.created_at, closed_at: i.closed_at,
        updated_at: i.updated_at,
      });
    }
    if (json.length < 100) break;
  }
  return out;
}

async function main() {
  const { makeGh, actionRepoContext } = await import('../signals/gh.mjs');
  const { discoverTasks } = await import('../discover.mjs');
  const { loadConfig, isDormant } = await import('../../checks/helpers/repo-context.mjs');
  const { ensureLabels, addLabel, removeLabel, comment, closeIssue, createIssue } = await import('../github.mjs');

  const root = process.cwd();
  const { repo } = actionRepoContext();
  if (!repo) { console.error('GITHUB_REPOSITORY not set — not in an Actions context'); process.exit(1); }
  const config = loadConfig(root);

  console.log('## Claudinite tick\n');
  if (isDormant(config)) {
    console.log('- this project declares itself dormant — no items instantiated, readied or reclaimed');
    return;
  }

  const gh = makeGh();
  const { tasks, errors } = await discoverTasks(root, config);
  for (const e of errors) console.log(`! ${e.what}`);

  const now = new Date();
  // Closed items matter only back to the widest occurrence guard (a monthly
  // task's period); older history can never change a verdict.
  const since = new Date(now.getTime() - 40 * 86400e3).toISOString();
  const items = await listWorkItems(gh, repo, { since });

  // A `Blocked-by` target need not be a work item — a fan-in blocks on whatever
  // its children are — so states come from the fetched items first and a direct
  // read otherwise.
  const known = new Map(items.map((i) => [i.number, i.state]));
  const wanted = new Set();
  for (const i of items) {
    if (i.state !== 'open' || !i.labels.includes(BLOCKED)) continue;
    for (const n of parseWorkItemBody(i.body).blockedBy) if (!known.has(n)) wanted.add(n);
  }
  for (const n of wanted) {
    const { status, json } = await gh(`/repos/${repo}/issues/${n}`);
    known.set(n, status === 200 ? json?.state ?? null : null);
  }

  const { ops } = planTick({
    tasks, items, now, schedule: config.taskScheduler, stateOf: (n) => known.get(n) ?? null,
  });

  if (ops.some((o) => o.kind === 'create')) await ensureLabels(gh, repo, QUEUE_LABELS);

  for (const op of ops) {
    if (op.kind === 'create') {
      const res = await createIssue(gh, repo, { title: op.title, body: op.body, labels: op.labels });
      if (res.number) console.log(`- created #${res.number} ${op.pack}/${op.task} [${op.labels.join(' ')}]`);
      else console.log(`! could not create the work item for ${op.pack}/${op.task}: ${res.status}`);
    } else if (op.kind === 'ready') {
      await removeLabel(gh, repo, op.issue, BLOCKED);
      await addLabel(gh, repo, op.issue, READY);
      console.log(`- readied #${op.issue}`);
    } else if (op.kind === 'reclaim') {
      // The reclaim comment is also the EPISODE BOUNDARY: every claim before it is
      // dead, and arbitrating over dead claims makes one outrank every future live
      // claimant — the item then livelocks through reclaim cycles forever (F18).
      await comment(gh, repo, op.issue, `${EPISODE_MARKER}\n${op.reason}`);
      await removeLabel(gh, repo, op.issue, EXECUTING);
      await addLabel(gh, repo, op.issue, op.to);
      console.log(`- reclaimed #${op.issue} -> ${op.to}`);
    } else if (op.kind === 'dedupe') {
      await comment(gh, repo, op.issue, op.reason);
      await addLabel(gh, repo, op.issue, OUTCOME_OBSOLETE);
      await closeIssue(gh, repo, op.issue, 'not_planned');
      console.log(`- deduped #${op.issue}`);
    }
  }

  if (!ops.length) console.log('- nothing to do: every task has its standing item, nothing is due, no claim is dead');

  // The forced wake, last: an item this run just instantiated is wakeable in the
  // same run, so a force never has to be pressed twice. The drain job that follows
  // picks up whatever this readies.
  const spec = process.env.CLAUDINITE_WAKE ?? '';
  if (spec.trim()) {
    const { wakeItem } = await import('./create-work-item.mjs');
    // Re-read: the ops above may have created or readied the very items named.
    const current = await listWorkItems(gh, repo, { since });
    const { wake, already, unmatched } = planWake(spec, tasks, current);
    for (const w of wake) {
      const res = await wakeItem(gh, repo, w.issue);
      console.log(res.ok ? `- woke #${w.issue} ${w.id}` : `! could not wake #${w.issue} ${w.id}: ${res.error}`);
    }
    for (const a of already) console.log(`- ${a.id} is already in flight on #${a.issue} — left alone`);
    for (const u of unmatched) console.log(`! nothing woken for "${u.id}": ${u.why}`);
    // A force that woke nothing is a failed force, and a green run saying so in a
    // log line is how it goes unnoticed by the fleet lever that pressed it.
    if (unmatched.length) process.exitCode = 1;
  }
}

// Run only when invoked directly (the workflow's `node tick.mjs`), never on import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

export { parseWorkItemTitle };
