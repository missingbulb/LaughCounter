// The PostToolUse verdict: a tool result a skill forces itself for
// (`force-load-on-tool-results-matching` in the skill's metadata —
// engine/pack_loader/path-scoped-skills.mjs) gets the load instruction injected
// beside the result, so the diagnosis a symptom calls for (a proxy denial, a
// missing module) is in front of the session the moment the symptom appears.
// Once per session: a skill already loaded is never asked for again. Never
// blocks; a judge that cannot decide says nothing. The runner in
// hook-runner.mjs writes the verdict.
import { hooklog } from '../checks/helpers/hook-log.mjs';
import { missingSkillsForResult } from '../pack_loader/path-scoped-skills.mjs';
import { hookContext, sessionReader, loadInstruction } from './hook-context.mjs';

export async function judge(payload) {
  if (typeof payload.tool_name !== 'string') return null;
  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const ctx = await hookContext(projectRoot, 'PostToolUse');
  const declarations = ctx.triggered.filter((d) => d.kind === 'toolResult');
  if (!declarations.length) return null;
  const call = { name: payload.tool_name, input: payload.tool_input ?? {} };
  const missing = missingSkillsForResult(call, payload.tool_response, declarations, sessionReader(payload.transcript_path).loaded);
  if (!missing.length) return null;
  hooklog('PostToolUse', `skill-trigger ${payload.tool_name} ${missing.map((d) => d.skill).join(',')}`);
  return { context: missing.map((d) =>
    `Claudinite: this ${payload.tool_name} result matches the \`${d.skill}\` skill's trigger (${d.source}, the ${d.pack} pack) — load it before acting on the result: ${loadInstruction([d], projectRoot)}.`).join('\n') };
}
