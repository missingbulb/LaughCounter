// THE ESCALATION SURFACE FOR A WORKFLOW THAT FAILED AS A WHOLE (tasks-dispatch
// DESIGN §10). A scheduled run reaches no one when it goes red — nothing is
// watching the Actions tab — so a run-level failure becomes a human-visible
// issue instead.
//
// ONE OPEN ISSUE, by a fixed title: create-or-comment, so a week of nightly
// failures is one thread rather than seven issues. The labels are ensured
// FIRST, because a first-run failure may precede any other label-ensure and
// GitHub 422s the write that applies an unknown label.
//
// The platform reporting its own failure IS an origin (`task:origin:github`),
// parked in the `failure` lane — the one a person diagnoses (#1119).
//
// This lives in the engine rather than in the workflows that call it because
// `.github/workflows/` is the one path a converge cannot push into: a member's
// copy of a workflow moves only through a PR a human merges, while this module
// converges nightly like the rest of the engine.

import { pathToFileURL } from 'node:url';
import { makeGh, actionRepoContext } from '../signals/gh.mjs';
import { ensureLabels, createIssue, comment } from '../github.mjs';
import { ORIGIN_GITHUB, STATUS_NEEDS_HUMAN_FAILURE } from './work-item.mjs';

// Not a queue label: this one marks the issue as the platform's own failure
// report rather than a work item, so it is defined here beside its only writer.
export const WORKFLOW_FAILURE = 'workflow-failure';

export const FAILURE_LABELS = Object.freeze([
  { name: WORKFLOW_FAILURE, color: 'b60205', description: 'Claudinite scheduler: a scheduler run or task failed' },
  { name: ORIGIN_GITHUB, color: 'd4c5f9', description: 'Claudinite queue: filed by the platform itself — a workflow reporting its own failure' },
  { name: STATUS_NEEDS_HUMAN_FAILURE, color: 'b60205', description: 'Claudinite queue: parked — the run broke, diagnose and fix' },
]);

// The open issue carrying exactly `title`, or null. Lowest number wins, so a past
// race that left two converges on the first and the duplicate stays inert.
//
// A search that does not answer returns null rather than throwing: filing a
// second issue is untidy, losing the failure report entirely is not.
export async function findOpenFailureIssue(gh, repo, title) {
  const want = title.trim();
  const q = encodeURIComponent(`repo:${repo} is:issue is:open in:title "${want}"`);
  const { status, json } = await gh(`/search/issues?q=${q}&per_page=100`);
  if (status !== 200 || !Array.isArray(json?.items)) return null;
  const exact = json.items
    .filter((i) => (i.title ?? '').trim() === want)
    .sort((a, b) => a.number - b.number);
  return exact.length ? exact[0].number : null;
}

export async function reportWorkflowFailure(gh, repo, { title, body }) {
  await ensureLabels(gh, repo, FAILURE_LABELS);
  const open = await findOpenFailureIssue(gh, repo, title);
  if (open != null) {
    await comment(gh, repo, open, body);
    return { issue: open, created: false };
  }
  const { number } = await createIssue(gh, repo, {
    title, body, labels: FAILURE_LABELS.map((l) => l.name),
  });
  return { issue: number, created: true };
}

// The URL of the run doing the reporting, or null outside Actions.
export const runUrl = (env = process.env) => (env.GITHUB_RUN_ID
  ? `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
  : null);

export const SCHEDULER_FAILURE_TITLE = 'Claudinite scheduler run failed';

// The scheduler workflow's `report-failure` job. It runs only when the scheduler
// run or its drain went red, so it files unconditionally.
async function main() {
  const { repo } = actionRepoContext();
  if (!repo) throw new Error('GITHUB_REPOSITORY is not set');
  const gh = makeGh();
  const { issue, created } = await reportWorkflowFailure(gh, repo, {
    title: SCHEDULER_FAILURE_TITLE,
    body: `The Claudinite scheduler run/drain run failed: ${runUrl()}`,
  });
  console.log(`- ${created ? 'filed' : 'commented on'} #${issue}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
