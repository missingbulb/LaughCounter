// The UserPromptSubmit verdict: an owner prompt a skill forces itself for
// (`force-load-on-prompts-matching` in the skill's metadata —
// engine/pack_loader/path-scoped-skills.mjs) gets the load instruction injected
// beside the prompt, so the procedure the phrase names ("LGTM", "/do-later")
// is in front of the session before it acts. Once per session: a skill already
// loaded is never asked for again. Never blocks, and a judge that cannot decide
// says nothing — an unreadable registry is the mount self-test's finding. The
// runner in hook-runner.mjs writes the verdict.
import { hooklog } from '../checks/helpers/hook-log.mjs';
import { missingSkillsForPrompt } from '../pack_loader/path-scoped-skills.mjs';
import { hookContext, sessionReader, loadInstruction } from './hook-context.mjs';

// A prompt trigger reads the owner's own words. The harness also delivers its
// pseudo-turns through this event — a task notification, a wake envelope, a
// system reminder — which open with a tag or that bracketed banner, quote
// whatever text they relay, and are nobody's request to act on a phrase.
const OWNER_PROMPT = /^\s*(?!<|\[SYSTEM NOTIFICATION)/;

export async function judge(payload) {
  const prompt = typeof payload.prompt === 'string' ? payload.prompt : '';
  if (!prompt.trim() || !OWNER_PROMPT.test(prompt)) return null;
  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const ctx = await hookContext(projectRoot, 'UserPromptSubmit');
  const declarations = ctx.triggered.filter((d) => d.kind === 'prompt');
  if (!declarations.length) return null;
  const missing = missingSkillsForPrompt(prompt, declarations, sessionReader(payload.transcript_path).loaded);
  if (!missing.length) return null;
  hooklog('UserPromptSubmit', `skill-trigger ${missing.map((d) => d.skill).join(',')}`);
  return { context: missing.map((d) =>
    `Claudinite: this prompt matches the \`${d.skill}\` skill's trigger (${d.source}, the ${d.pack} pack) — load it before acting on the prompt: ${loadInstruction([d], projectRoot)}.`).join('\n') };
}
