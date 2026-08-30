import { finding } from '../../../engine/checks/helpers/findings.mjs';
import {
  AUTOMERGE_TRAILER, AUTOMERGE_TRAILER_RE, policyVerdict, declaredMergeRules,
} from '../merge-policy.mjs';

// The armed-auto-merge gate: when a branch says it intends to land itself under
// a granular policy, the diff must actually sit inside that policy — re-checked
// here, at the Stop hook and on every PR, so a run that mis-measured (or lied
// about) its own diff goes red before GitHub's queued auto-merge can fire.
//
// SELF-GATING BY THE TRAILER, the shape improve-comments-scope keys on its
// pinned commit subject: a landing run stamps `Claudinite-Automerge-Policy:
// <expr>` into its final commit message (deliver-pr.md owns when), so this rule
// runs everywhere the pack is active and costs ~nothing on a branch that armed
// nothing. No trailer, no findings — a wide PR left open for review must stay
// green, since red CI would get it closed as failed rather than read. The LAST
// trailer on the branch wins: a run that re-measured after amending its scope
// states its final intent last.
//
// The policy is re-evaluated from the trailer, not re-read from the task
// declaration, because the branch may BE the thing changing declarations; what
// keeps the trailer honest is the policy engine's own self-widening guard — no
// granular policy covers a change to the policy sources — plus the landing lane
// only merging on the same verdict this rule computes.
const rule = {
  id: 'automerge-policy-scope',
  severity: 'blocking',
  scope: 'work',
  doc: 'packs/claudinite-tasks/README.md',
  description: 'A branch that stamps the Claudinite-Automerge-Policy trailer — its run intends to land its own PR — carries only a diff that policy actually covers',
  why: 'the trailer is a claim that this diff may merge with nobody looking; a diff outside the declared classes is exactly the unreviewed change the policy exists to stop, and only a check can hold the claim to the measurement',

  run(work) {
    if (work.onDefaultBranch()) return [];
    // work.commits is newest-first (git log order), so the newest commit's
    // trailer — the branch's final stated intent — is the first match.
    const armed = work.commits.map((m) => AUTOMERGE_TRAILER_RE.exec(m)?.[1]).find(Boolean);
    if (armed === undefined) return [];

    const deleted = new Set(work.deleted);
    const entries = [...new Set([...work.changedFiles, ...work.deleted])].sort().map((file) => ({
      file,
      before: work.readBase(file),
      after: deleted.has(file) ? null : work.read(file),
    }));
    const { rules, errors } = declaredMergeRules(work.packs, work.config);
    const verdict = policyVerdict({ policy: armed, entries, declaredRules: rules, ruleErrors: errors });
    if (verdict.mergeable) return [];

    return verdict.problems.map((p) => finding(rule, {
      file: p.file ?? '(branch)',
      what: `this branch armed auto-merge (${AUTOMERGE_TRAILER}: ${armed}) but ${p.what}`,
      fix: p.file
        ? `revert or split out ${p.file}, or drop the trailer from the branch's last commit and leave the PR for review — never widen the policy to fit the diff`
        : 'make the diff satisfy the armed policy, or drop the trailer and leave the PR for review',
    }));
  },
};

export default rule;
