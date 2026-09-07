import { relative, sep } from 'node:path';
import { finding } from '../../../engine/checks/helpers/findings.mjs';
import { isActive } from '../../../engine/pack_loader/pack-registry.mjs';
import { taskDeclarationFiles } from '../discover.mjs';
import { parseTaskDeclaration } from '../task-declaration.mjs';
import { normalizeTaskDeclaration } from '../task-contract.mjs';
import { EXECUTOR_WORKFLOW, taskSecretNames, secretEnvLine, passesSecret } from '../converge-workflows.mjs';

// A secret reaches a task only if the executor workflow names it STATICALLY — that
// is Actions' rule, and the reason the wiring converge stamps one env line per
// declared secret rather than one `toJSON(secrets)` (converge-workflows.mjs says why
// the cheap shape is not available). But `.github/workflows/` is the one directory a
// member's converge may not push to, so that file is scaffolded once at adoption and
// never regenerated: every task added afterwards declares a secret the executor still
// does not carry.
//
// Nothing catches the drift. The declaration is valid, the queue picks the item up,
// the run starts, and only then does the worker read `process.env.<NAME>` as undefined,
// and code-work that reads its own secret may not say anything at all.
//
// THE LIST IS THE TASKS', and only theirs: the packs a repo declares, shared and local
// alike, have tasks, and what those tasks require is what the executor must carry (the
// owner's call). An invocation endpoint's `tokenSecret` is repo config rather than a
// task declaration, so it is not on this list — the converge stamps it all the same
// (`secretNames`), and the invocation call names it precisely when a job does not carry
// it (queue/invoke.mjs), which is the surface that case already had.
//
// ADVISORY, DELIBERATELY, for `conformance-workflow`'s reason: the remedy is a
// human-merged PR to `.github/workflows/`, the one fix a member's own machinery
// cannot make. Blocking would turn such a member red with no move of its own to
// clear it, every night, until a person happened to look.
//
// The expectation is COMPUTED BY THE SAME CODE the converge stamps with
// (`taskSecretNames`) over the same walk discovery makes (`taskDeclarationFiles`), so
// this cannot hold a second opinion of what the file should say. Extra names in the
// workflow are not a finding: a member that dropped a task keeps a harmless line, as
// does one whose executor carries an endpoint token.
const rule = {
  id: 'executor-workflow-secrets',
  severity: 'advisory',
  description: 'The executor workflow passes every secret the tasks of this repo\'s packs declare',
  doc: 'packs/claudinite-tasks/README.md',
  why: 'a secret the executor does not name statically never reaches the job, and the task fails only once the queue has already picked its item up',

  run(ctx) {
    const expected = taskSecretNames(taskDeclarations(ctx));
    if (!expected.length) return [];
    const text = ctx.read(EXECUTOR_WORKFLOW);
    const missing = text === null ? expected : expected.filter((name) => !passesSecret(text, name));
    if (!missing.length) return [];
    return [finding(rule, {
      file: EXECUTOR_WORKFLOW,
      line: text === null ? null : markerLine(text),
      what: text === null
        ? `is missing, so nothing passes ${missing.join(', ')} to the executor`
        : `does not pass ${missing.join(', ')}, which the tasks of this repo's packs declare`,
      fix: `add ${missing.map((n) => `\`${secretEnvLine(n).trim()}\``).join(' and ')} to the executor's env, beneath its \`# claudinite:secrets\` marker — this pack's \`converge-workflows.mjs <owner/repo>\` (under \`.claudinite/shared/\` in a member) writes the whole list — and get that PR merged: a converge cannot push to .github/workflows/. Setting the repository secret itself is the other half`,
    })];
  },
};

// Every ACTIVE pack's task declarations, parsed but not validated — this rule asks
// one field of them, and a declaration another check will reject still tells the
// truth about which secret it needs. `ctx.packs` is what the runner discovered.
function taskDeclarations(ctx) {
  const { found } = taskDeclarationFiles(ctx.root, (ctx.packs ?? []).filter((p) => isActive(p, ctx.config)));
  const out = [];
  for (const { file } of found) {
    const text = ctx.read(relative(ctx.root, file).split(sep).join('/'));
    if (text === null) continue;
    try { out.push(normalizeTaskDeclaration(parseTaskDeclaration(text))); } catch { /* the declaration checks own a file that will not parse */ }
  }
  return out;
}

const markerLine = (text) => {
  const at = text.search(/^[ \t]*# claudinite:secrets\b/m);
  return at < 0 ? null : text.slice(0, at).split('\n').length;
};

export default rule;
