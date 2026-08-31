// The verify-production code-work (#1530) — the I/O shell around probes.mjs. It
// runs Action-side, which is the whole reason this task exists: an agent session
// has no egress, so a verification whose artifact is a live URL (a Pages site, a
// deployed config) can only be read from here.
//
// Four verdicts, each its own exit:
//   invalid  — the spec is unreadable: the triage marker names every problem and
//              the exit is non-zero, so the item parks with the list.
//   not-live — a liveness probe failed: print the requeue marker with
//              now + Retry-every and exit clean; the executor re-arms the item.
//   pass     — comment the evidence on the item and exit clean; the executor
//              closes it done.
//   fail     — reopen Original-issue with the evidence (the verification did its
//              job by finding the fault, which is now that issue's), link it from
//              the item, and exit clean.

import { pathToFileURL } from 'node:url';
import { humanTextOf } from '../../queue/work-item.mjs';
import { parseVerificationSpec, runProbes, renderResult } from './probes.mjs';

const FETCH_TIMEOUT_MS = 30_000;
const BODY_CAP = 2 * 1024 * 1024;

// One live fetch: bounded, redirect-following, body capped. A network error is
// retried once — a single blip must not reopen an issue — and the second failure
// is the answer.
export async function fetchOnce(url) {
  const attempt = async () => {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const body = (await res.text()).slice(0, BODY_CAP);
    return { status: res.status, body };
  };
  try { return await attempt(); } catch { return attempt(); }
}

// The whole judgment, injectable for tests: reads the item, parses the spec out
// of the HUMAN half of its body (the machine block is the queue's), runs the
// probes, and lands the verdict's writes. Returns what main() turns into markers
// and an exit code.
export async function runVerification({ gh, repo, itemNumber, fetchUrl, now = () => new Date(), log = console.log }) {
  const { status, json: item } = await gh(`/repos/${repo}/issues/${itemNumber}`);
  if (status !== 200) throw new Error(`could not read item #${itemNumber}: ${status}`);
  const spec = parseVerificationSpec(humanTextOf(item.body));
  if (spec.problems.length) return { outcome: 'invalid', problems: spec.problems };

  const live = await runProbes(spec.live, fetchUrl);
  for (const r of live) log(`liveness: ${renderResult(r)}`);
  if (!live.every((r) => r.ok)) {
    const firstFail = live.find((r) => !r.ok);
    return {
      outcome: 'not-live',
      until: new Date(now().getTime() + spec.retryEveryMs).toISOString(),
      reason: `not yet live: ${renderResult(firstFail)}`,
    };
  }

  const verify = await runProbes(spec.verify, fetchUrl);
  for (const r of verify) log(`verify: ${renderResult(r)}`);
  const evidence = verify.map((r) => `- ${renderResult(r)}`).join('\n');
  if (verify.every((r) => r.ok)) {
    await gh(`/repos/${repo}/issues/${itemNumber}/comments`, {
      method: 'POST',
      body: { body: `Production verification PASSED. What was read:\n\n${evidence}` },
    });
    return { outcome: 'pass' };
  }

  // The verification did its job by finding the fault — which is now the
  // original issue's, reopened with what was asserted and what was read.
  await gh(`/repos/${repo}/issues/${spec.originalIssue}`, { method: 'PATCH', body: { state: 'open' } });
  await gh(`/repos/${repo}/issues/${spec.originalIssue}/comments`, {
    method: 'POST',
    body: {
      body: `The production verification filed for this change (#${itemNumber}) FAILED against the live artifact:\n\n${evidence}\n\n`
        + 'The release is live (every liveness probe passed), so this is a fault in production, not a wait.',
    },
  });
  await gh(`/repos/${repo}/issues/${itemNumber}/comments`, {
    method: 'POST',
    body: { body: `Verification FAILED — reopened #${spec.originalIssue} with the evidence:\n\n${evidence}` },
  });
  return { outcome: 'fail', originalIssue: spec.originalIssue };
}

export async function main() {
  const repo = process.env.CLAUDINITE_REPO;
  const itemNumber = Number(process.env.CLAUDINITE_ITEM);
  if (!repo || !itemNumber) throw new Error('CLAUDINITE_REPO / CLAUDINITE_ITEM not set — not running under the executor');
  if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is not set — the verification cannot read its item');
  const { makeGh } = await import('../../signals/gh.mjs');
  const verdict = await runVerification({ gh: makeGh(), repo, itemNumber, fetchUrl: fetchOnce });

  if (verdict.outcome === 'invalid') {
    console.log(`claudinite-needs-human: action — this verification's probe spec is unreadable: ${verdict.problems.join('; ')}`);
    process.exit(1);
  }
  if (verdict.outcome === 'not-live') {
    console.log(`claudinite-requeue: ${verdict.until} — ${verdict.reason}`);
    return;
  }
  console.log(`verification ${verdict.outcome === 'pass' ? 'passed' : `failed — reopened #${verdict.originalIssue}`}`);
}

// Run only when invoked directly (code-work's `node worker.mjs`), never on import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`verify-production failed: ${e.message}`); process.exit(1); });
}
