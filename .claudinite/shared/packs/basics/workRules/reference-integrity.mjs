import { finding } from '../../../engine/checks/helpers/findings.mjs';
import { stripComments } from '../../../engine/checks/helpers/code-scanning.mjs';

// A deleted path a migration record (<pack>/migrations/<date>-<slug>/) still
// names isn't stale — it's the declared legacy shape the record documents.
// Matched on basename: a legacy alias usually carries a consumer-side prefix.
// Read from the tracked tree, since what a record governs follows from the
// record existing, not from this branch happening to touch it — and from the
// record's declarations, not the prose around them.
const MIGRATION_SPEC = /(^|\/)migrations\/[^/]+\/migration\.mjs$/;
const migrationGoverns = (work) => {
  let records = null;
  return (gone) => {
    records ??= (work.tracked ?? [])
      .filter((f) => MIGRATION_SPEC.test(f))
      .map((f) => stripComments(work.read(f) ?? ''))
      .join('\n');
    return records.includes(gone.split('/').pop());
  };
};

const rule = {
  id: 'reference-integrity',
  severity: 'blocking',
  description: 'Relative Markdown links must resolve, and no tracked file may reference a deleted path',
  doc: 'packs/basics/skills/repo-text-sweeps/SKILL.md',
  scope: 'work',
  why: 'a dangling reference breaks silently — no test fails when a doc link or index entry points at nothing',

  run(work) {
    return [
      ...work.deadLinks().map(({ file, line, target, resolved }) => finding(rule, {
        file, line,
        what: `relative link → ${target} resolves to ${resolved}, which does not exist`,
        fix: 'correct the path or restore the target; when moving or deleting a file, update every inbound reference in the same change',
      })),
      ...work.danglingReferences(migrationGoverns(work)).map(({ file, line, gone }) => finding(rule, {
        file, line,
        what: `still references ${gone}, which this branch deletes`,
        fix: `update or remove the reference — grep the whole tree for "${gone}" and fix every hit in this same change`,
      })),
    ];
  },
};

export default rule;
