import { finding } from '../../../engine/checks/helpers/findings.mjs';
// Namespace-imported and guarded for the same reason legacy-shape-in-use is: a
// member's pack lane and engine lane converge on separate cycles, and this pack
// can sit beside a task-contract that predates either export.
import * as contract from '../task-contract.mjs';
import * as declarationText from '../task-declaration-text.mjs';

// THE ADVISORY HALF OF THE TASK CONTRACT'S FIELD TOLERANCES. `normalizeTaskDeclaration`
// accepts two generations of field names and the retired one-word outcome
// ceilings, so a task declared in the oldest vocabulary runs exactly like one
// declared today — and nothing told its author that the acceptance ends a week
// after this advisory ships (#1642).
//
// It reads the declaration SOURCE rather than the normalized object, because by
// the time anything holds a task declaration the legacy spelling is gone: the
// door normalizes at load, which is what makes the tolerance invisible.
// Matching is therefore textual and deliberately conservative — a top-level key
// line in a task declaration — so the finding always points at a line an author
// can edit. Both declaration forms are read, and one pattern covers both: the
// key is bare in the module form and quoted in the JSON, and the value quote is
// whichever that file uses.
//
// ADVISORY: the old spelling works, and a task file is a member's own content.
const TASK_FILE = /(^|\/)tasks\/[^/]+\/task\.(json|mjs)$/;
const isTaskFile = (path) =>
  (typeof declarationText.isTaskDeclarationPath === 'function'
    ? declarationText.isTaskDeclarationPath(path)
    : TASK_FILE.test(path));

const rule = {
  id: 'legacy-task-fields',
  severity: 'advisory',
  since: '2026-09-03',
  description: 'Task declarations name their fields and outcome in the current vocabulary',
  why: 'the contract accepts two retired generations of field names and the one-word outcome ceilings for one convergence window after this advisory ships (#1642) — nothing counts who is still on them, so a declaration not renamed inside that window simply stops being read',

  run(ctx) {
    const fields = contract.LEGACY_FIELDS ?? {};
    const outcomes = contract.LEGACY_OUTCOMES ?? {};
    const names = Object.keys(fields);
    if (names.length === 0 && Object.keys(outcomes).length === 0) return [];

    const fieldRe = names.length ? new RegExp(`^\\s*"?(${names.join('|')})"?\\s*:`) : null;
    const outcomeRe = /^\s*"?expected_outcome"?\s*:\s*['"]([^'"]+)['"]/;

    const out = [];
    for (const file of ctx.files.filter(isTaskFile)) {
      const text = ctx.read(file);
      if (text === null) continue;
      text.split('\n').forEach((text_line, i) => {
        const field = fieldRe?.exec(text_line);
        if (field) {
          out.push(finding(rule, {
            file,
            line: i + 1,
            what: `declares the retired field \`${field[1]}\``,
            fix: `rename it to \`${fields[field[1]]}\` — the contract maps every retired spelling straight to today's name, so this is a one-line edit with no behaviour change`,
          }));
        }
        const outcome = outcomeRe.exec(text_line);
        if (outcome && Object.hasOwn(outcomes, outcome[1])) {
          out.push(finding(rule, {
            file,
            line: i + 1,
            what: `declares the retired outcome ceiling \`${outcome[1]}\``,
            fix: `write \`expected_outcome: 'pr'\` with \`automerge: '${outcomes[outcome[1]]}'\` beside it — the one word always meant that pair, and spelling it out is what lets the policy be narrowed later`,
          }));
        }
      });
    }
    return out;
  },
};

export default rule;
