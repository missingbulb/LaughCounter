// THE TERMINAL TRANSITION, IN CODE (#892; tasks-dispatch DESIGN §6.5, §15.18,
// §15.19). A work-item session ends by performing five ordered side effects —
// comment, drop `task:agent`, add the outcome label, carry the execution record,
// close with the right state reason — and then releasing whatever the close
// freed. Asking a session to do that from prose is asking for it at the moment
// its context is fullest and the remaining work looks like formality; both of the
// first two live agentic runs got part of it wrong, silently, in different ways.
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
import { readyDependents } from './readiness.mjs';
import { swapStatus, clearStatus } from './apply-status.mjs';
import {
  AGENT, NEEDS_HUMAN, TASK_DONE, STATUS_RUNNING_AGENT, isStatus, isWorkItemTitle, machineBlockOf,
  NEEDS_HUMAN_ACTION, NEEDS_HUMAN_APPROVAL, NEEDS_HUMAN_DECISION, NEEDS_HUMAN_FAILURE,
  QUEUED_LABEL, IN_REVIEW_LABEL,
  parseWorkItemTitle, parseWorkItemBody,
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

export async function convergeItem(api, gh, repo, plan, { now = () => new Date(), log = console.log } = {}) {
  const item = await api.readIssue(gh, repo, plan.issue);
  const no = refusal(item, plan.issue);
  if (no) return { ok: false, error: no };

  const spec = OUTCOMES[plan.outcome];
  await api.comment(gh, repo, item.number, convergeComment(item, { ...plan, record: spec.record }));
  // The record goes to BOTH sinks, and neither is redundant: the comment is the
  // durable one (Actions logs expire, the item does not), while this printed copy
  // lands in the session transcript, which is what the usage fold reads for the
  // task-status census. The fold dedupes on the record's own tuple within a
  // capture file, so a line appearing in stdout and in the harness's echo of it
  // counts once.
  const rec = recordLine(item, spec.record);
  if (rec) log(rec);
  if (spec.closes) {
    await clearStatus(api, gh, repo, item, STATUS_RUNNING_AGENT);
    await api.addLabel(gh, repo, item.number, spec.label);
    // A MARKED ISSUE IS NOT THE SESSION'S TO CLOSE (§16.1, §16.5): the terminal
    // status stands on the open issue, and whether the issue itself is finished
    // belongs to the person who opened it. Nothing is released, because the issue a
    // dependent waits on has not closed.
    if (!isWorkItemTitle(item.title ?? '')) return { ok: true, closed: false, freed: [] };
    await api.closeIssue(gh, repo, item.number, spec.stateReason);
    // §15.19: whoever closes an item releases what it was holding.
    const freed = await readyDependents(api, gh, repo, item.number, { now, log });
    return { ok: true, closed: true, freed };
  }
  // Every park wears BOTH labels: `needs-human` is the state every guard and
  // sweep reads, the sub-label is what the person is being asked for.
  await swapStatus(api, gh, repo, item, STATUS_RUNNING_AGENT, NEEDS_HUMAN);
  await api.addLabel(gh, repo, item.number, spec.label);
  // A REQUEST ITEM WRITES BACK TO ITS ISSUE, on the one end that is its business
  // (§16.5). Only the approval park: a failure deliberately writes nothing and
  // leaves `claude-queued` standing, because re-arming work that writes code is a
  // person's decision and that standing label is what stops the next scheduler run queueing
  // a second run of the same request.
  // Only a LEGACY shadow item writes back to a different issue: under the one-issue
  // model the approval park stands on the marked issue itself and IS the in-review
  // state, with nothing to mirror (§16.5).
  const { request } = parseWorkItemBody(item.body ?? '');
  if (request && request !== item.number && plan.outcome === 'approval') {
    await api.comment(gh, repo, request,
      `A pull request for this is open and waiting on you: #${plan.pr}. Merge or close it.`);
    await api.swapLabel(gh, repo, request, QUEUED_LABEL, IN_REVIEW_LABEL);
  }
  return { ok: true, closed: false, freed: [], request: request ?? null };
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
  if (!repo) { console.error('converge-item: GITHUB_REPOSITORY is not set'); process.exit(1); }

  const res = await convergeItem(api, makeGh(), repo, plan);
  if (!res.ok) { console.error(`converge-item: ${res.error}`); process.exit(1); }
  console.log(res.closed
    ? `converged #${plan.issue}: closed ${OUTCOMES[plan.outcome].label}`
      + (res.freed.length ? `, released ${res.freed.map((n) => `#${n}`).join(', ')}` : '')
    : `converged #${plan.issue}: parked ${OUTCOMES[plan.outcome].label}, left open for a person`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
