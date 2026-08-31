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
// THIS FILE RUNS IN ONE PLACE: INSIDE A WORK-ITEM SESSION. `queue/instructions.md`
// step 6 is its only caller — no workflow invokes it, no module imports it. The
// Actions side converges through `executor.mjs`, which owns that path entirely.
//
// SO EVERY LINE HERE ASSUMES MCP, AND NOTHING HERE MAY REACH THE NETWORK. A session
// holds its GitHub access through its own tools; a subprocess it spawns has no route
// to them and none to the REST API. This file therefore PLANS a transition and
// PRINTS it addressed to those tools — it never performs one. Printing the calls is
// the successful outcome, on stdout, exit 0. That is not a fallback: it is the only
// path, and it must never read as a failure. A REST executor lived here once and did
// (#1491) — a session met its `console.error` before it met the path written for it,
// reported that it could not converge, and left the item to the janitor's 3h leash,
// which parks a finished run as a human decision. Five sampled items across five
// repos were exactly that.
//
// The split is the same one the executor already draws: THE SESSION SUPPLIES THE
// JUDGMENT — which outcome, and the prose of what happened — and the CODE decides
// every step of the transition. A session that stops early now leaves an item that
// is visibly unconverged, rather than one that looks finished and is not.
//
// Usage — the item is handed in, because this process cannot read it:
//   node converge-item.mjs --issue <n> --outcome <done|approval|action|decision|failure>
//                          --summary <text> [--pr <n>]
//                          --repo <owner/name> --item-file <path to the issue as JSON>

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { renderTaskExec } from '../run-record.mjs';
import {
  AGENT, TASK_DONE, STATUS_RUNNING_AGENT, isStatus, machineBlockOf,
  NEEDS_HUMAN_ACTION, NEEDS_HUMAN_APPROVAL, NEEDS_HUMAN_DECISION, NEEDS_HUMAN_FAILURE,
  QUEUED_LABEL, IN_REVIEW_LABEL, ORIGIN_LABELS, hasLabel,
  parseWorkItemTitle, parseWorkItemBody, spellingsOf, labelNames,
  editItemBody, withEndsWhen,
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
  return {
    issue, outcome: args.outcome, summary: args.summary, pr: args.pr ? Number(args.pr) : null,
    repo: args.repo || null, itemFile: args['item-file'] || null,
  };
}

// Why an item may NOT be converged by this call. Refusing loudly beats writing a
// terminal state onto the wrong issue: this runs from a session, whose whole
// notion of which item it holds came from an untrusted fire payload.
export function refusal(item, issue) {
  if (!item) return `#${issue} could not be read`;
  // A marked issue IS its own item (DESIGN §16.1), so the title test cannot be the
  // membership test any more: what says this is one is the machine block adoption
  // wrote — never the body's first line, which on a marked issue is a person's prose.
  //
  // THREE SIGNALS, ANY ONE SUFFICIENT. A membership test gated on the single artifact
  // it exists to validate refuses exactly the items that artifact is missing from: an
  // issue adopted before the block delimiters existed carries its fields bare, and was
  // refused here into a by-hand convergence that dropped half the transition
  // (missingbulb/Shepherd#360). The origin label is the independent one — carried for
  // life, and platform-write-gated like the block was.
  const marked = ORIGIN_LABELS.some((name) => hasLabel(item, name));
  if (!parseWorkItemTitle(item.title ?? '') && machineBlockOf(item.body ?? '') === null && !marked) {
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

  // THE PARK'S END CONDITION (#1468). The comment above already tells a person to
  // merge or close the pull request; this says the same thing where the janitor can
  // read it, so the item ends when that happens instead of waiting for someone to
  // notice it already did. Every park that names one gets it, not only `approval`.
  if (!spec.closes && plan.pr) {
    ops.push({ kind: 'setBody', issue: item.number, body: editItemBody(item.body, (m) => withEndsWhen(m, plan.pr)) });
  }

  if (spec.closes) {
    // A DONE TERMINAL CLOSES THE ISSUE IT STANDS ON, marked or filed (#1489,
    // reversing §16.1/§16.5's "never a marked issue"). `done` is the one outcome
    // that means nothing is left for anyone to act on, so an issue left open under
    // it asks its author to come and agree with what the run already settled. Every
    // other outcome parks, and a park leaves the issue open to be waited on.
    ops.push({ kind: 'close', issue: item.number, stateReason: spec.stateReason });
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
  // The body write folds into the item's own `issue_write`, which is one call
  // either way. A park never closes, so the step it folds into is the trailing
  // label write below.
  let newBody = null;

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
    } else if (op.kind === 'setBody' && op.issue === item.number) {
      newBody = op.body;
    } else if (op.kind === 'close') {
      step(`\`issue_write\` — method \`update\`, owner \`${owner}\`, repo \`${name}\`, issue_number \`${op.issue}\`,`
        + ` labels \`${JSON.stringify([...own])}\`, state \`closed\`, state_reason \`${op.stateReason}\``);
      own.clear();
    }
  }
  // A park never closed, so its label write is still owed.
  if (own.size) {
    step(`\`issue_write\` — method \`update\`, owner \`${owner}\`, repo \`${name}\`, issue_number \`${item.number}\`,`
      + ` labels \`${JSON.stringify([...own])}\``
      + (newBody === null ? '' : `, body exactly:\n\n<<<BODY\n${newBody}\n>>>END\n`));
  }
  for (const op of foreign) {
    step(`On #${op.issue}: ${op.kind === 'addLabel' ? 'ADD' : 'REMOVE'} the label \`${op.name}\`.`
      + ` Read that issue's current labels first and write them back with only this one change —`
      + ` \`issue_write\` replaces the whole set, and this process never saw the rest.`);
  }
  return lines.join('\n');
}

async function main() {
  const plan = parseArgs(process.argv.slice(2));
  if (plan.error) {
    console.error(`converge-item: ${plan.error}`);
    process.exit(2);
  }

  // The repo this item lives in. `--repo` is what instructions.md passes; the two
  // environment names answer for a session whose harness sets one of them.
  const repo = plan.repo ?? process.env.CLAUDINITE_ITEM_REPO ?? process.env.GITHUB_REPOSITORY ?? null;
  if (!repo) {
    console.error('converge-item: --repo <owner/name> names the repository this item lives in');
    process.exit(2);
  }

  // THE ITEM IS HANDED IN. This process cannot read it — that is the whole premise
  // of the file — so the session reads it with its own tools and passes it through.
  // A file rather than an argument: an item's body is prose of arbitrary length, and
  // a shell-quoted one is a quoting bug waiting for the first apostrophe.
  // `CLAUDINITE_ITEM_JSON` stays readable for a member whose instructions.md is a
  // cycle behind, since a mount updates on its own schedule.
  const raw = plan.itemFile
    ? await readFile(plan.itemFile, 'utf8')
    : (process.env.CLAUDINITE_ITEM_JSON ?? '');
  let item = null;
  try { item = JSON.parse(raw || 'null'); } catch { item = null; }
  if (!item) {
    console.error('converge-item: --item-file must hold the issue as your GitHub tools returned it'
      + ' (number, title, body, state, labels).\n'
      + `Read it first: \`issue_read\` method \`get\` on ${repo} #${plan.issue}, save the JSON, pass the path.`);
    process.exit(2);
  }

  const no = refusal(item, plan.issue);
  if (no) { console.error(`converge-item: ${no}`); process.exit(1); }

  // The successful outcome. Everything below is the transition, decided here and
  // performed by the session — so it goes to stdout and the process exits clean.
  console.log('converge-item: the transition below is yours to execute.\n'
    + 'Make these calls with your GitHub tools, in this order, changing nothing. Then stop.\n');
  console.log(sessionScript(item, plan, repo));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
