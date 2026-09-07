// The PreToolUse verdict, three duties in this order (the runner in
// hook-runner.mjs writes it; nothing here exits or writes):
//  - a file tool (Edit, Write, NotebookEdit) aimed at a path one of an active
//    pack's skills names under `force-load-on-file-edits-paths` — or any tool
//    call one names under `force-load-on-tool-calls` — is blocked until the
//    session has loaded that skill, so the skill is read before the first edit
//    or call exists, not after a Stop-time finding has sent the agent back over
//    work done;
//  - the active packs' ACTION declarations (`scope: "action"`, `guardToolCalls` —
//    the vocabulary in engine/checks/helpers/pattern-rules.mjs) are judged
//    against the call about to run: a blocking finding denies it and hands the
//    agent the finding's text, an advisory one lets it run and injects the text
//    as context, so a bias is heard at the moment it applies. The context
//    carries no permissionDecision: `allow` would skip the permission prompt
//    for the call, and an advisory has no business approving anything. The
//    same declarations run again over the transcript at Stop, advisory
//    there whatever the severity — the record for a hook that never fired;
//  - a Bash command that deletes a remote branch is blocked (the delete-push
//    fails in this environment, so it can never succeed).
// Registered on every tool (the converge's PRETOOLUSE_MATCHER) — see
// bootstrap.md. A call no declaration names costs the cached context read
// (hook-context.mjs) and says nothing. A guard that cannot decide lets the call
// through: an unreadable declaration or registry is the mount self-test's
// finding, never a session wedged on tools.
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { hooklog } from '../checks/helpers/hook-log.mjs';
import { applyGrace } from '../checks/helpers/findings.mjs';
import { guardFindings } from '../checks/helpers/pattern-rules.mjs';
import { missingSkillsFor, missingSkillsForCall } from '../pack_loader/path-scoped-skills.mjs';
import { hookContext, sessionReader, loadInstruction } from './hook-context.mjs';

// The file a tool is about to write, repo-relative with forward slashes — or null
// when the tool names no file or the file is outside the project (nothing here
// scopes a path the repo does not own).
function targetPath(payload, projectRoot) {
  const input = payload.tool_input ?? {};
  const raw = payload.tool_name === 'NotebookEdit' ? input.notebook_path : input.file_path;
  if (typeof raw !== 'string' || !raw) return null;
  const abs = isAbsolute(raw) ? raw : resolve(projectRoot, raw);
  const rel = relative(projectRoot, abs);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel.split(sep).join('/');
}

const FILE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);
const packsOf = (missing) => [...new Set(missing.map((d) => d.pack))].join(', ');
const namesOf = (missing) => missing.map((d) => `\`${d.skill}\``).join(' and ');

function fileToolBlock(payload, projectRoot, ctx, session) {
  const path = targetPath(payload, projectRoot);
  if (!path || !ctx.scoped.length) return null;
  const missing = missingSkillsFor(path, ctx.scoped, session.loaded);
  if (!missing.length) return null;
  const names = missing.map((d) => d.skill);
  hooklog('PreToolUse', `done exit=2 skill-not-loaded ${path} needs ${names.join(',')}`);
  return {
    reason: 'skill-not-loaded',
    block: `Blocked: ${path} is edited only with the ${namesOf(missing)} skill loaded `
      + `(the ${packsOf(missing)} pack's skill forces itself for ${missing.map((d) => d.files).join(', ')}). `
      + `Load it first — ${loadInstruction(missing, projectRoot)} — then retry the edit.`,
  };
}

// The tool-call triggers: a call a skill forces itself for is held until the
// skill is loaded, exactly as an edit under a scoped path is.
function toolCallTriggerBlock(call, projectRoot, ctx, session) {
  const declarations = ctx.triggered.filter((d) => d.kind === 'toolCall');
  if (!declarations.length) return null;
  const missing = missingSkillsForCall(call, declarations, session.loaded);
  if (!missing.length) return null;
  const names = missing.map((d) => d.skill);
  hooklog('PreToolUse', `done exit=2 skill-not-loaded-for-call ${call.name} needs ${names.join(',')}`);
  return {
    reason: 'skill-not-loaded-for-call',
    block: `Blocked: ${call.name} is called only with the ${namesOf(missing)} skill loaded `
      + `(the ${packsOf(missing)} pack's skill forces itself for ${missing.map((d) => d.source).join(', ')}). `
      + `Load it first — ${loadInstruction(missing, projectRoot)} — then retry the call.`,
  };
}

// The action declarations judged against this call: a blocking finding is the
// block, advisory ones the context. Grace applies as at Stop: a blocking guard
// inside its `since` window advises.
function actionVerdict(call, ctx, session) {
  const rules = ctx.actionRules.filter((r) => ctx.overrides[r.id] !== 'off');
  if (!rules.length) return {};
  let findings = [];
  for (const rule of rules) {
    const countsCalls = (rule.spec?.guardToolCalls ?? []).some((a) => a.atMostPerSession !== undefined);
    let found;
    try { found = guardFindings(rule, call, countsCalls ? session.calls() : []); }
    catch (e) { hooklog('PreToolUse', `action-guard-failed ${rule.id} ${e?.message ?? e}`); continue; }
    const level = ctx.overrides[rule.id];
    findings.push(...found.map((f) => (level === 'advisory' || level === 'blocking' ? { ...f, severity: level } : f)));
  }
  findings = applyGrace(findings);
  const render = (f) => `${f.what}. ${f.why ? `${f.why}. ` : ''}Fix: ${f.fix}`;
  const blocking = findings.filter((f) => f.severity === 'blocking');
  if (blocking.length) {
    hooklog('PreToolUse', `done exit=2 action-guard ${blocking.map((f) => f.rule).join(',')}`);
    return { block: blocking.map((f) => `Blocked by ${f.rule}: ${render(f)}`).join('\n'), reason: 'action-guard' };
  }
  const advisory = findings.filter((f) => f.severity === 'advisory');
  if (!advisory.length) return {};
  hooklog('PreToolUse', `advisory action-guard ${advisory.map((f) => f.rule).join(',')}`);
  return { context: advisory.map((f) => `[claudinite ${f.rule}] ${render(f)}`).join('\n') };
}

function remoteBranchDeleteBlock(input) {
  const cmd = typeof input?.command === 'string' ? input.command : '';
  const deletesRemoteBranch =
    /\bgit\s+push\b[^\n;&]*\s(--delete|-d)\s/.test(cmd) ||
    /\bgit\s+push\b[^\n;&]*\s\S+\s+:\S/.test(cmd);
  if (!deletesRemoteBranch) return null;
  // Log only the block — the interesting event. An allowed command every Bash
  // call would flood the log and drown the SessionStart signal it exists for.
  hooklog('PreToolUse', 'done exit=2 blocked-remote-branch-delete');
  return {
    reason: 'blocked-remote-branch-delete',
    block: 'Blocked: never delete a remote branch — a current environment bug makes the delete-push fail, so it cannot succeed. Leave the branch; it can be deleted from the GitHub UI if needed.',
  };
}

export async function judge(payload) {
  if (typeof payload.tool_name !== 'string') return null;
  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const call = { name: payload.tool_name, input: payload.tool_input ?? {} };
  const session = sessionReader(payload.transcript_path);
  let context = '';
  try {
    const ctx = await hookContext(projectRoot, 'PreToolUse');
    const held = (FILE_TOOLS.has(call.name) && fileToolBlock(payload, projectRoot, ctx, session))
      || toolCallTriggerBlock(call, projectRoot, ctx, session);
    if (held) return held;
    const action = actionVerdict(call, ctx, session);
    if (action.block) return action;
    context = action.context ?? '';
  } catch (e) {
    hooklog('PreToolUse', `done exit=0 guard-failed ${e?.message ?? e}`);
  }
  if (call.name === 'Bash') {
    const del = remoteBranchDeleteBlock(call.input);
    if (del) return del;
  }
  return context ? { context } : null;
}
