// Put the repository-variable bag into every member's live executor workflow (#1509).
//
// WHAT IT DELIVERS. #1494 added `CLAUDINITE_VARS: ${{ toJSON(vars) }}` to the executor
// STUB and shipped the reader (queue/vars-bag.mjs). A stub is scaffolded once at
// adoption, so every member already running the queue holds the reader and no line for
// it to read — `varsEnv` finds no bag and contributes nothing, which is safe but inert.
// This record is what closes that gap on a member that adopted before #1494.
//
// A REWRITE, NOT A MATERIALIZE. The executor is not identical across members: the wiring
// converge stamps each one's own `required_secrets` beneath the `# claudinite:secrets`
// marker. Copying the stub over it would deliver the line and take every member's
// secrets with it, which is a far worse outcome than the gap this closes. A rewrite
// preserves everything it does not name — the same reason static-website's record
// rewrites rather than replaces.
//
// IDEMPOTENCY LIVES IN `appliesTo`, not in the replacement. `applyRewrites` uses
// split/join, so running this twice against an already-rewritten file would insert a
// SECOND copy of the block; the version gate makes that unlikely and `appliesTo` makes
// it impossible. Both halves are load-bearing.
//
// THE ANCHOR is the operator hold, which every member's executor carries — the stub
// guard in converge-workflows.test.mjs pins it in both stubs, and it has been in the
// file since the hold shipped. Anchoring to the `# claudinite:secrets` marker instead
// would put the bag inside the converge's stamped region, where the next wiring
// converge would regenerate over it.
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
  id: 'executor-vars-bag',
  landed: '2026-08-31',
  version: '60831.6',
  summary: 'the live executor workflow carries CLAUDINITE_VARS, so a task can read a repo variable the workflow never names (#1492, #1494)',

  // Two conditions, both required: the member runs the queue (it has an executor with
  // the hold to anchor to), and it does not already carry the bag. The second is what
  // makes a re-run a no-op rather than a doubled block.
  appliesTo: async (read) => {
    const text = await read(EXECUTOR);
    if (!text) return false;
    return text.includes(HOLD) && !text.includes('CLAUDINITE_VARS:');
  },

  rewrite: [{ file: EXECUTOR, replace: [{ from: HOLD, to: HOLD + BAG }] }],

  // The old shape is an executor with no bag — exactly what `appliesTo` tests, so a
  // member is "still legacy" on the same condition that makes this record apply.
  legacyPresent: async (_exists, read) => {
    const text = await read(EXECUTOR);
    return Boolean(text) && text.includes(HOLD) && !text.includes('CLAUDINITE_VARS:');
  },
};
