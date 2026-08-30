// Post-hoc enforcement of a task's declared outcome ceiling (per-project-scheduling
// DESIGN §1, §5.5). The executor runs this in code AFTER the subagent finishes:
// the outcome is a ceiling enforced, not merely requested in prose, so a `none`
// task that opened a PR — or a task that merged one with nothing authorized —
// fails the run and converges to needs-human. "No change" is always legal.
//
// This seam judges LANE-LEVEL facts only (did the run open, did it merge). A
// granular `automerge` policy permits the merge here; whether the actual
// diff sat inside the policy is the policy engine's verdict (merge-policy.mjs),
// made where the tree is readable — the landing lane's CLI and the
// automerge-policy-scope work check.
//
// Pushes to non-default branches (e.g. the conversation-logs prune) are outside
// the PR taxonomy (DESIGN §1) and are not judged here — the caller passes only
// what the task did to PULL REQUESTS.

import { OUTCOMES, LEGACY_OUTCOMES } from './task-contract.mjs';
import { normalizePolicy } from './merge-policy.mjs';

// Verify what a task actually did against its declared ceiling.
//   outcome      — the declared ceiling ('none' | 'pr'; the legacy 'open-pr' /
//                  'merged-pr' are judged as the pair they normalize to, so a
//                  fielded caller passing a raw declaration stays correct)
//   automerge — the declared merge policy; absent reads as 'nothing', and an
//                  unparsable one the same — a permission that cannot be read
//                  was never granted
//   openedPr     — did the run open a pull request?
//   mergedPr     — did the run merge (or arm auto-merge on) a pull request?
// Returns { ok, violation } — violation is null when within the ceiling.
export function verifyOutcome({ outcome, automerge, openedPr = false, mergedPr = false }) {
  const legacyPolicy = LEGACY_OUTCOMES[outcome];
  const ceiling = legacyPolicy !== undefined ? 'pr' : outcome;
  const policy = automerge ?? legacyPolicy ?? 'nothing';
  if (!OUTCOMES.includes(ceiling)) {
    return { ok: false, violation: `unknown outcome ceiling "${outcome}"` };
  }
  // Merging implies a PR exists; treat a merge as also having opened one so a
  // caller that only reports mergedPr is still judged correctly.
  const opened = openedPr || mergedPr;

  if (ceiling === 'none' && opened) {
    return { ok: false, violation: 'a "none" task must not open or merge a pull request' };
  }
  if (ceiling === 'pr' && mergedPr) {
    const norm = normalizePolicy(policy);
    if (norm.kind === 'nothing' || norm.kind === 'invalid') {
      return { ok: false, violation: 'a task whose automerge authorizes nothing must not merge a pull request' };
    }
  }
  return { ok: true, violation: null };
}
