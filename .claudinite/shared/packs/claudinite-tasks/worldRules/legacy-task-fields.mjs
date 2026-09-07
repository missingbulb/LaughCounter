import { finding } from '../../../engine/checks/helpers/findings.mjs';
// Namespace-imported and guarded for the same reason legacy-shape-in-use is: a
// member's pack lane and engine lane converge on separate cycles, and this pack
// can sit beside a task-contract that predates either export.
import * as contract from '../task-contract.mjs';
import * as calendar from '../calendar.mjs';
import * as declarationText from '../task-declaration-text.mjs';

// THE ADVISORY HALF OF THE TASK CONTRACT'S FIELD TOLERANCES. `normalizeTaskDeclaration`
// accepts two generations of field names, the retired one-word outcome ceilings,
// the retired `frequency` field (which reads as the cadence term it always meant,
// tasks-dispatch DESIGN §5) and a declaration stating no `trigger` (whose value is
// derived from the shape of its conditions), so a task declared in the oldest
// vocabulary runs exactly like one declared today — and nothing told its author that
// the acceptance ends a convergence window after this advisory ships (#1642, #1725).
//
// The trigger half is the odd one: what it reports is an ABSENCE, not a spelling, so
// there is no wrong line to point at — it points at the line the field goes ON, which
// is the anchor the nightly rewrite uses to put it there.
//
// It reads the declaration SOURCE rather than the normalized object, because by
// the time anything holds a task declaration the legacy spelling is gone: the
// door normalizes at load, which is what makes the tolerance invisible.
// Matching is therefore textual and deliberately conservative — a top-level key
// line in a task declaration — so the finding always points at a line an author
// can edit. The key is quoted and the value quote is whichever the file uses.
//
// ADVISORY: the old spelling works, and a task file is a member's own content.
const TASK_FILE = /(^|\/)tasks\/[^/]+\/task\.json$/;
const isTaskFile = (path) =>
  (typeof declarationText.isTaskDeclarationPath === 'function'
    ? declarationText.isTaskDeclarationPath(path)
    : TASK_FILE.test(path));

const rule = {
  id: 'legacy-task-fields',
  severity: 'advisory',
  since: '2026-09-03',
  description: 'Task declarations name their fields and outcome in the current vocabulary',
  why: 'the contract accepts two retired generations of field names, two retired generations of outcome ceilings, the retired frequency field and an unstated trigger for one convergence window after this advisory ships (#1642, #1725) — nothing counts who is still on them, so a declaration not brought up to the vocabulary inside that window simply stops being read',

  run(ctx) {
    const fields = contract.LEGACY_FIELDS ?? {};
    const outcomes = contract.LEGACY_OUTCOMES ?? {};
    const ceilings = contract.LEGACY_CEILINGS ?? {};
    const names = Object.keys(fields);
    if (names.length === 0 && Object.keys(outcomes).length === 0 && Object.keys(ceilings).length === 0) return [];

    const fieldRe = names.length ? new RegExp(`^\\s*"?(${names.join('|')})"?\\s*:`) : null;
    const outcomeRe = /^\s*"?expected_outcome"?\s*:\s*['"]([^'"]+)['"]/;
    // The cadence field, retired into the expression. Guarded on the engine
    // exporting the term spelling: beside an older calendar the field is not a
    // tolerance yet, and reporting it would ask for an edit that engine rejects.
    const frequencyRe = typeof calendar.cadenceTermFor === 'function' ? /^\s*"?frequency"?\s*:\s*['"]([^'"]+)['"]/ : null;

    // Guarded on the engine carrying the field at all: beside an older contract a
    // declaration stating no trigger is not on a tolerance yet, and asking for the
    // key would ask for one that engine's own schema rejects.
    const triggers = Array.isArray(contract.TRIGGERS) ? contract.TRIGGERS : null;
    const statedTrigger = /^\s*"?trigger"?\s*:/;
    // Where the field goes, in the order the rewrite tries them: with the conditions
    // it reads as one sentence, else before the outcome the contract requires.
    const triggerAnchors = [/^\s*"?preconditions"?\s*:/, /^\s*"?expected_outcome"?\s*:/];

    const out = [];
    for (const file of ctx.files.filter(isTaskFile)) {
      const text = ctx.read(file);
      if (text === null) continue;
      const lines = text.split('\n');
      if (triggers && !lines.some((l) => statedTrigger.test(l))) {
        const anchor = triggerAnchors.map((re) => lines.findIndex((l) => re.test(l))).find((i) => i !== -1);
        // Only where there is a line to point at: a declaration with neither anchor
        // is malformed, and the shape check is what says so.
        if (anchor !== undefined) {
          // The value the door would derive, so the fix is the edit and not a choice.
          const conditions = /"?preconditions"?\s*:\s*\[([^\]]*)\]/.exec(text)?.[1] ?? '';
          const implied = conditions.split(',').some((e) => e.replace(/['"]/g, '').split('||').some((alt) => alt.trim() !== ''))
            ? contract.TRIGGER_SCHEDULE : contract.TRIGGER_REQUEST;
          out.push(finding(rule, {
            file,
            line: anchor + 1,
            what: 'states no `trigger`, so whether the scheduler asks it is read off the shape of its conditions',
            fix: `state it — \`"trigger": "${implied}"\` is what those conditions are read as today, so writing it changes nothing except that the next reader can see it; the nightly update writes it into a member's own task files`,
          }));
        }
      }
      lines.forEach((text_line, i) => {
        const field = fieldRe?.exec(text_line);
        if (field) {
          out.push(finding(rule, {
            file,
            line: i + 1,
            what: `declares the retired field \`${field[1]}\``,
            fix: `rename it to \`${fields[field[1]]}\` — the contract maps every retired spelling straight to today's name, so this is a one-line edit with no behaviour change`,
          }));
        }
        const frequency = frequencyRe?.exec(text_line);
        if (frequency) {
          const term = (calendar.ACCEPTED_FREQUENCIES ?? []).includes(frequency[1]) ? calendar.cadenceTermFor(frequency[1]) : 'due:<daily|weekly|monthly>';
          const fix = term === null
            ? 'write `"trigger": "request"` and drop the field, and a `"none"` beside it: `"manual"` meant no schedule at all, which a declaration now says outright; the nightly update rewrites a member\'s own task files'
            : `write it as the first condition — \`"preconditions": ["${term}", …]\` — with \`"trigger": "schedule"\` beside it, and drop a \`"none"\`; the field reads as exactly that today, and the nightly update rewrites a member's own task files`;
          out.push(finding(rule, {
            file,
            line: i + 1,
            what: 'declares the retired field `frequency`',
            fix,
          }));
        }
        const outcome = outcomeRe.exec(text_line);
        if (outcome && Object.hasOwn(outcomes, outcome[1])) {
          out.push(finding(rule, {
            file,
            line: i + 1,
            what: `declares the retired outcome ceiling \`${outcome[1]}\``,
            fix: `write \`expected_outcome: 'fresh_pr'\` with \`automerge: '${outcomes[outcome[1]]}'\` beside it — the one word always meant that pair, and spelling it out is what lets the policy be narrowed later`,
          }));
        } else if (outcome && Object.hasOwn(ceilings, outcome[1])) {
          out.push(finding(rule, {
            file,
            line: i + 1,
            what: `declares the retired outcome ceiling \`${outcome[1]}\``,
            fix: `write \`expected_outcome: '${ceilings[outcome[1]]}'\` — the word it became, in the vocabulary that also says amend_existing_or_create_new_pr and supersede_existing_pr`,
          }));
        }
      });
    }
    return out;
  },
};

export default rule;
