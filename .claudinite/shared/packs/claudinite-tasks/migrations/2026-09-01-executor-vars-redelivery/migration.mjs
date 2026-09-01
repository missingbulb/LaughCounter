// Re-deliver the repository-variable bag to members the first record can no longer
// reach (#1545).
//
// WHY A SECOND RECORD EXISTS FOR ONE CHANGE. `2026-08-31-executor-vars-bag` is correct
// and still applies to anything below `claudinite-tasks` 60831.6. What it cannot reach
// is a member that stamped PAST 60831.6 without receiving it: `migrationApplies` is
// `want > have`, so above the number the record stops applying and stops vendoring,
// and the staged copy is swept by the next cycle as a leftover. Five members reached
// exactly that state when their apply-stage PRs were merged before the stage delivered
// the withheld file. The stamp is no longer advanced while a file is owed, but nothing
// retroactively lowers a stamp already written, so the only way back into range is a
// record at a version above where they landed.
//
// IT IS NOT A DUPLICATE DELIVERY. `appliesTo` tests the destination's own content, so
// on a member that already carries the line this is inert; the eight that received it
// normally see nothing. That guard is also what makes the pair safe on a member below
// 60831.6, where both records are in range — the first writes the line and the second
// then finds it present.
//
// WHY THE BLOCK IS COPIED HERE RATHER THAN IMPORTED FROM THE FIRST RECORD. The vendor
// set carries only the records that still APPLY to that member, and the whole premise
// here is a member the first record no longer applies to — so importing it resolves to
// a file that member's mount does not have, the pack fails pack-independence, and the
// converge refuses to land at all. A record must be self-contained for the same reason
// it is dated: it is read on a repo whose mount holds a different set than the canon's.
// `executor-vars-records-agree` pins the copy against the original.
//
// The anchor and the shape are the first record's; see it for why the rewrite anchors
// on the operator hold rather than the `# claudinite:secrets` marker, why this is a
// rewrite rather than a materialize, and why idempotency lives in `appliesTo`.
const EXECUTOR = '.github/workflows/claudinite-executor.yml';
const HOLD = '          CLAUDINITE_TASKS_SUSPEND_ALL: ${{ vars.CLAUDINITE_TASKS_SUSPEND_ALL }}\n';
const BAG = `          # Every repository VARIABLE, as one static line (#1492). Unlike the secrets
          # below this never changes: \`vars\` is the context GitHub's own docs define as
          # non-sensitive and render unmasked in logs, so serialising it is not the
          # exfiltration shape that gets a workflow held for approval (#1336) — and this
          # file is the one path a converge cannot write, so keeping it independent of
          # what any task declares is worth a great deal. vars-bag.mjs is the reader.
          CLAUDINITE_VARS: \${{ toJSON(vars) }}
`;

export default {
  id: 'executor-vars-redelivery',
  landed: '2026-09-01',
  version: '60901.1',
  summary: 'the executor workflow carries CLAUDINITE_VARS on members that stamped past the first record without receiving it (#1545)',

  appliesTo: async (read) => {
    const text = await read(EXECUTOR);
    if (!text) return false;
    return text.includes(HOLD) && !text.includes('CLAUDINITE_VARS:');
  },

  rewrite: [{ file: EXECUTOR, replace: [{ from: HOLD, to: HOLD + BAG }] }],

  legacyPresent: async (_exists, read) => {
    const text = await read(EXECUTOR);
    return Boolean(text) && text.includes(HOLD) && !text.includes('CLAUDINITE_VARS:');
  },
};
