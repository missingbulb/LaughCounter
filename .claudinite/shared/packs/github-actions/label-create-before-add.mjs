import { patternRule } from '../../engine/checks/helpers/pattern-rules.mjs';
import { WORKFLOW_FILE } from '../../engine/checks/helpers/github-workflows.mjs';

export default patternRule({
  id: 'gha/label-create-before-add',
  severity: 'advisory',
  description: 'A workflow applying a label should create it idempotently first',
  doc: 'skills/git-github-advanced/SKILL.md',
  why: '--add-label fails when the label does not exist yet — GitHub will not create it on demand',
  files: WORKFLOW_FILE,
  over: 'tracked',
  file: [{
    if: /--add-label/,
    require: /label create/,
    what: 'uses --add-label with no idempotent `gh label create … || true` beforehand',
    fix: 'create the label idempotently before adding it, so the workflow survives its first run',
  }],
});
