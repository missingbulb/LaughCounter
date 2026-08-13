import { patternRule } from '../../engine/checks/helpers/pattern-rules.mjs';

export default patternRule({
  id: 'claude-md-length',
  severity: 'advisory',
  description: 'A CLAUDE.md over ~200 lines costs context and reduces adherence',
  doc: 'skills/authoring-agent-docs/SKILL.md',
  why: 'everything in CLAUDE.md loads every session; past ~200 lines it crowds out the rules that matter',
  files: 'CLAUDE.md',
  maxLines: {
    limit: 200,
    what: '{lines} lines (target under {limit})',
    fix: 'move multi-step procedures to skills and part-of-repo rules to path-scoped packs; keep CLAUDE.md to always-true facts',
  },
});
