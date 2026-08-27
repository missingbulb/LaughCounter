// THE TERMINAL TRANSITION, IN CODE (#892; tasks-dispatch DESIGN §6.5, §15.18).
// A work-item session ends by performing five ordered side effects — comment,
// drop `task:agent`, add the outcome label, carry the execution record, close
// with the right state reason — on the item it holds, and nothing else: a
// converge never writes to another work item (§15.19, reversed by §15.31 /
// #1373). Releasing a dependent a close may have freed is the scheduler run's
// job alone. Asking a session to perform these effects from prose is asking for
// it at the moment its context is fullest and the remaining work looks like
// formality; both of the first two live agentic runs got part of it wrong,
// silently, in different ways.
//
// The split is the same one the executor already draws: THE SESSION SUPPLIES THE
// JUDGMENT — which outcome, and the prose of what happened — and the CODE
// performs the transition. A session that stops early now leaves an item that is
// visibly unconverged, rather than one that looks finished and is not.
//
// Usage:
//   node converge-item.mjs --issue <n> --outcome <done|approval|action|decision|failure>
//                          --summary <text> [--pr <n>]

import { pathToFileURL } from 'node:url';
import { renderTaskExec } from '../run-record.mjs';
import {
  AGENT, TASK_DONE, STATUS_RUNNING_AGENT, isStatus, isWorkItemTitle, machineBlockOf,
  NEEDS_HUMAN_ACTION, NEEDS_HUMAN_APPROVAL, NEEDS_HUMAN_DECISION, NEEDS_HUMAN_FAILURE,
  QUEUED_LABEL, IN_REVIEW_LABEL,
  parseWorkItemTitle, parseWorkItemBody, spellingsOf, labelNames,
} from './work-item.mjs';

// What a session may claim, and what each one means for the item. `record` is the
// execution-record status, and `null` means no record: an approval park is a run
// that SUCCEEDED and left a PR, which the record vocabulary has no word for, and
// a fifth status would be stored data every decoder in the fleet must learn.
export const OUTCOMES = Object.freeze({
  done: { label: TASK_DONE, closes: true, stateReason: 'completed', record: 'success' },
  approval: { label: NEEDS_HUMAN_APPROVAL, closes: false, record: null },
  action: { label: NEEDS_HUMAN_ACTION, closes: false, record: 'failed' },
  decision: { label: NEEDS_HUMAN_DECISION, closes: false, record: 'failed' },
  failure: { label: NEEDS_HUMAN_FAILURE, closes: false, record: 'failed' },
});

export function parseArgs(argv) {
  const args = {};
  for (let n = 0; n < argv.length; n += 1) {
    const m = /^--([a-z-]+)$/.exec(argv[n]);
    if (m) { args[m[1]] = argv[n + 1] ?? ''; n += 1; }
  }
  const issue = Number(args.issue);
  if (!Number.isInteger(issue) || issue <= 0) return { error: '--issue must be the work item\'s issue number' };
  if (!OUTCOMES[args.outcome]) {
    return { error: `--outcome must be one of ${Object.keys(OUTCOMES).join(', ')}, got ${JSON.stringify(args.outcome ?? null)}` };
  }
  if (!String(args.summary ?? '').trim()) return { error: '--summary must say what happened; it is the item\'s only durable account' };
  if (args.outcome === 'approval' && !args.pr) {
    return { error: '--pr must name the pull request an approval park is waiting on — a park nobody can act on is not a park' };
  }
  return { issue, outcome: args.outcome, summary: args.summary, pr: args.pr ? Number(args.pr) : null };
}

// Why an item may NOT be converged by this call. Refusing loudly beats writing a
// terminal state onto the wrong issue: this runs from a session, whose whole
// notion of which item it holds came from an untrusted fire payload.
export function refusal(item, issue) {
  if (!item) return `#${issue} could not be read`;
  // A marked issue IS its own item (DESIGN §16.1), so the title test cannot be the
  // membership test any more: what says this is one is the machine block adoption
  // wrote — never the body's first line, which on a marked issue is a person's prose.
  if (!parseWorkItemTitle(item.title ?? '') && machineBlockOf(item.body ?? '') === null) {
    return `#${issue} is not a Claudinite work item`;
  }
  if (item.state !== 'open') return `#${issue} is already closed — it was converged once already`;
  if (!isStatus(item, STATUS_RUNNING_AGENT)) {
    return `#${issue} is not with an agent (\`${AGENT}\`) — this session does not hold it, so it is not this session's to converge`;
  }
  return null;
}

// The record line for this item, or null where the vocabulary has no true answer.
export const recordLine = (item, status) => {
  const parsed = parseWorkItemTitle(item.title);
  return status && parsed
    ? renderTaskExec({ pack: parsed.pack, task: parsed.task, slotId: `#${item.number}`, status })
    : null;
};

// The comment one converge writes: the session's account, then the record, so a
// reader and a parser both find what they came for in one place.
export function convergeComment(item, { summary, pr, record }) {
  const rec = recordLine(item, record);
  const line = rec ? `\n\n\`\`\`\n${rec}\n\`\`\`` : '';
  const waiting = pr ? `\n\nWaiting on a person: merge or close #${pr}, then close this item.` : '';
  return `${summary.trim()}${waiting}${line}`;
}

// THE TRANSITION AS DATA (#1374). The side effects were a straight line of
// `await api.…` calls, which silently made REST the only way to perform them —
// and the sessions `invoke.mjs` hands work to have no REST route to their own
// repository, so the last step of every agentic run was the one step that
// environment could not take.
//
// So the sequence is planned as OPS and executed by whoever can. The planner is
// the single source of what a convergence IS; the executors differ only in
// transport. The session still supplies nothing but the judgment.
//
// Removes are granular and unconditional — every spelling of the status being
// left, not only the ones this snapshot shows (apply-status.mjs's rule: a member's
// items outlive its converges, so an item may wear an older engine's spelling).
export function convergeOps(item, plan) {
  const spec = OUTCOMES[plan.outcome];
  const ops = [{ kind: 'comment', issue: item.number, body: convergeComment(item, { ...plan, record: spec.record }) }];

  // The record goes to BOTH sinks, and neither is redundant: the comment above is
  // the durable one (Actions logs expire, the item does not), while this printed
  // copy lands in the session transcript, which is what the usage fold reads for
  // the task-status census.
  const rec = recordLine(item, spec.record);
  if (rec) ops.push({ kind: 'record', line: rec });

  for (const label of spellingsOf(STATUS_RUNNING_AGENT)) {
    ops.push({ kind: 'removeLabel', issue: item.number, name: label });
  }
  // ONE label, on both paths: the outcome IS the status. A park in particular is
  // never a pair, so nothing can be half-applied (#1385).
  ops.push({ kind: 'addLabel', issue: item.number, name: spec.label });

  if (spec.closes) {
    // A MARKED ISSUE IS NOT THE SESSION'S TO CLOSE (§16.1, §16.5): the terminal
    // status stands on the open issue, and whether the issue itself is finished
    // belongs to the person who opened it.
    if (isWorkItemTitle(item.title ?? '')) ops.push({ kind: 'close', issue: item.number, stateReason: spec.stateReason });
    return ops;
  }

  // A REQUEST ITEM WRITES BACK TO ITS ISSUE, on the one end that is its business
  // (§16.5). Only the approval park: a failure deliberately writes nothing and
  // leaves `claude-queued` standing, because re-arming work that writes code is a
  // person's decision and that standing label is what stops the next scheduler run
  // queueing a second run of the same request. Only a LEGACY shadow item writes
  // back to a different issue.
  const { request } = parseWorkItemBody(item.body ?? '');
  if (request && request !== item.number && plan.outcome === 'approval') {
    ops.push({ kind: 'comment', issue: request, body: `A pull request for this is open and waiting on you: #${plan.pr}. Merge or close it.` });
    ops.push({ kind: 'removeLabel', issue: request, name: QUEUED_LABEL });
    ops.push({ kind: 'addLabel', issue: request, name: IN_REVIEW_LABEL });
  }
  return ops;
}

// THE REST EXECUTOR — what an Actions run does, unchanged in behaviour.
export async function convergeItem(api, gh, repo, plan, { log = console.log } = {}) {
  const item = await api.readIssue(gh, repo, plan.issue);
  const no = refusal(item, plan.issue);
  if (no) return { ok: false, error: no };

  let closed = false;
  for (const op of convergeOps(item, plan)) {
    if (op.kind === 'comment') await api.comment(gh, repo, op.issue, op.body);
    else if (op.kind === 'record') log(op.line);
    else if (op.kind === 'removeLabel') await api.removeLabel(gh, repo, op.issue, op.name);
    else if (op.kind === 'addLabel') await api.addLabel(gh, repo, op.issue, op.name);
    else if (op.kind === 'close') { await api.closeIssue(gh, repo, op.issue, op.stateReason); closed = true; }
  }
  const { request } = parseWorkItemBody(item.body ?? '');
  return { ok: true, closed, request: request ?? null };
}

// THE SESSION EXECUTOR'S SCRIPT. Same ops, addressed to the GitHub tools a session
// does have. Two differences forced by that surface, both handled here rather than
// left to the session to work out:
//
//  - THERE IS NO GRANULAR LABEL WRITE. `issue_write` replaces the whole set, so the
//    granular removes and adds are folded into the FINAL set here, computed from the
//    labels this item was read with. Everything not a status label is carried through.
//  - THE RECORD IS PRINTED BY THE SESSION, which is where it has to be anyway: the
//    usage fold reads the census out of the session transcript.
export function sessionScript(item, plan, repo) {
  const [owner, name] = String(repo).split('/');
  const lines = [];
  let n = 0;
  const step = (s) => { n += 1; lines.push(`${n}. ${s}`); };

  // The item's own label set can be computed exactly, because the item was read
  // with its labels. Any OTHER issue's cannot — so that one is emitted as a
  // read-modify-write naming only the change, and never as a computed set, which
  // would silently drop every label this process never saw.
  const own = new Set(labelNames(item));
  const foreign = [];

  for (const op of convergeOps(item, plan)) {
    if (op.kind === 'comment') {
      step(`\`add_issue_comment\` — owner \`${owner}\`, repo \`${name}\`, issue_number \`${op.issue}\`, body exactly:\n\n<<<BODY\n${op.body}\n>>>END\n`);
    } else if (op.kind === 'record') {
      step(`Output this line, on its own, in your reply. Nothing else emits it, and the usage census is read from your transcript:\n\n    ${op.line}\n`);
    } else if (op.kind === 'removeLabel' || op.kind === 'addLabel') {
      if (op.issue === item.number) {
        if (op.kind === 'removeLabel') own.delete(op.name); else own.add(op.name);
      } else {
        foreign.push(op);
      }
    } else if (op.kind === 'close') {
      step(`\`issue_write\` — method \`update\`, owner \`${owner}\`, repo \`${name}\`, issue_number \`${op.issue}\`,`
        + ` labels \`${JSON.stringify([...own])}\`, state \`closed\`, state_reason \`${op.stateReason}\``);
      own.clear();
    }
  }
  // A park never closed, so its label write is still owed.
  if (own.size) {
    step(`\`issue_write\` — method \`update\`, owner \`${owner}\`, repo \`${name}\`, issue_number \`${item.number}\`,`
      + ` labels \`${JSON.stringify([...own])}\``);
  }
  for (const op of foreign) {
    step(`On #${op.issue}: ${op.kind === 'addLabel' ? 'ADD' : 'REMOVE'} the label \`${op.name}\`.`
      + ` Read that issue's current labels first and write them back with only this one change —`
      + ` \`issue_write\` replaces the whole set, and this process never saw the rest.`);
  }
  return lines.join('\n');
}

// CAN THIS PROCESS ACTUALLY REACH THE REPO? Read the status, never the body: a
// token that is absent, expired, or simply not a REST credential all answer with a
// plausible JSON object and a 401/403, and a body-only test reads that as a repo.
// One request, before any write, because the alternative is discovering it halfway
// through a sequence that was meant to be atomic.
export async function canReachRepo(gh, repo) {
  const { status } = await gh(`/repos/${repo}`);
  return status === 200;
}

async function main() {
  const plan = parseArgs(process.argv.slice(2));
  if (plan.error) {
    console.error(`converge-item: ${plan.error}`);
    process.exit(2);
  }
  const { makeGh, actionRepoContext } = await import('../signals/gh.mjs');
  const api = await import('../github.mjs');
  const { repo } = actionRepoContext();
  const gh = repo ? makeGh() : null;

  if (repo && await canReachRepo(gh, repo)) {
    const res = await convergeItem(api, gh, repo, plan);
    if (!res.ok) { console.error(`converge-item: ${res.error}`); process.exit(1); }
    console.log(res.closed
      ? `converged #${plan.issue}: closed ${OUTCOMES[plan.outcome].label}`
      : `converged #${plan.issue}: parked ${OUTCOMES[plan.outcome].label}, left open for a person`);
    return;
  }

  // NO REST ROUTE — the normal case for a session, not a breakage. The session has
  // GitHub access of its own; what it lacks is a way to reach it from a
  // subprocess. So the same plan is emitted addressed to the tools it does have,
  // and the session performs its own convergence. Nothing is deferred and nobody
  // else is involved: one run finishes one item.
  const sessionRepo = repo ?? process.env.CLAUDINITE_ITEM_REPO ?? null;
  if (!sessionRepo) {
    console.error('converge-item: no repository — pass GITHUB_REPOSITORY or CLAUDINITE_ITEM_REPO');
    process.exit(2);
  }
  const item = JSON.parse(process.env.CLAUDINITE_ITEM_JSON ?? 'null');
  if (!item) {
    console.error('converge-item: this process cannot reach the REST API, so it cannot read the item either.\n'
      + 'Re-run with CLAUDINITE_ITEM_JSON set to the issue as your GitHub tools returned it'
      + ' (number, title, body, state, labels), and it will print the exact calls to make.');
    process.exit(2);
  }
  const no = refusal(item, plan.issue);
  if (no) { console.error(`converge-item: ${no}`); process.exit(1); }

  console.log(`converge-item: no REST route from this session, so the transition is yours to execute.\n`
    + `Make these calls with your GitHub tools, in this order, changing nothing. Then stop.\n`);
  console.log(sessionScript(item, plan, sessionRepo));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
