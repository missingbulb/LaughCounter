import { finding } from '../../../engine/checks/helpers/findings.mjs';

// The Stop-time backstop behind `shared-tree-edit-guard`, this pack's PreToolUse
// guard on the same tree. The guard is the moment that matters — it denies the
// write before it happens — but it only sees an agent's own tool calls in a
// session whose hooks are installed, so a script, a `git apply`, or a member
// running with no hook lands the edit unseen. This rule reads what the branch
// actually committed.
//
// It cannot be a declaration. `.claudinite/shared/` is structurally filtered out
// of the scanned file set (repo-context.mjs — the vendored corpus is canon-owned
// and out of scope for every ordinary check), so `ctx.changedFiles` never carries
// a path under it and every path-matching key in the declared vocabulary is blind
// here by construction. Reading the branch's own commits is the only surface that
// still sees the tree.
//
// The update flow is the one legitimate writer: its worker commits under the PR
// title it composes (tasks/update/worker.mjs), so a converge PR — every member's,
// every night — is exempt by that title rather than by a branch-name convention.
const SHARED_ROOT = '.claudinite/shared/';
const UPDATE_RUN = /^Claudinite update\b/;

const rule = {
  id: 'shared-tree-immutable',
  severity: 'blocking',
  since: '2026-09-06',
  scope: 'work',
  doc: 'packs/claudinite-lifecycle/RULES.md',
  description: 'A branch never commits an edit under .claudinite/shared/ — the update flow replaces that tree whole',
  why: 'the update flow overwrites .claudinite/shared/ on its next converge, so a hand-edit there is either silently lost or briefly masks a mount gone stale — the fix belongs in the canon, or as a local override under .claudinite/local/packs/',

  run(work) {
    if (work.onDefaultBranch()) return [];
    if (work.commits.some((m) => UPDATE_RUN.test(m))) return [];
    const touched = [...new Set(work.branchCommits().flatMap((c) => c.files))];
    return touched
      .filter((p) => p.startsWith(SHARED_ROOT))
      .sort()
      .map((p) => finding(rule, {
        file: p,
        what: `this branch commits ${p}, inside the vendored ${SHARED_ROOT} tree`,
        fix: `revert that file and make the change in the canon instead, or — for a difference this repo alone needs — carry it under .claudinite/local/packs/, which sits beside the mount and survives every converge`,
      }));
  },
};

export default rule;
