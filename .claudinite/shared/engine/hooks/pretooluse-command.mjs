#!/usr/bin/env node
// Claude Code PreToolUse guard, two duties:
//  - a Bash command that deletes a remote branch is blocked (the delete-push fails
//    in this environment, so it can never succeed);
//  - a file tool (Edit, Write, NotebookEdit) aimed at a path one of an active
//    pack's skills names under `force-load-on-file-edits-paths` is blocked until the
//    session has loaded that skill — so the skill is read before the first edit
//    exists, not after a Stop-time finding has sent the agent back over work done.
// Exit 2 blocks the tool call and feeds stderr back to the agent; the block is the
// one message the agent needs. Registered per-repo — see bootstrap.md.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hooklog } from '../checks/helpers/hook-log.mjs';
import { parseEntries, skillLoads } from '../checks/helpers/session-transcript.mjs';
import { pathScopedSkills, missingSkillsFor } from '../pack_loader/path-scoped-skills.mjs';
import { settingsPath } from '../settings-file.mjs';

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

async function activePacks(projectRoot) {
  // This module lives at <corpus>/engine/hooks/ — the same root the mount hook
  // resolves the registry from, so the canon runs it from its own tree.
  const corpusRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  let declared = [];
  const configPath = settingsPath(projectRoot);
  if (existsSync(configPath)) {
    const raw = JSON.parse(readFileSync(configPath, 'utf8'));
    if (Array.isArray(raw.packs)) declared = raw.packs;
  }
  const { loadPacks, isActive } = await import(join(corpusRoot, 'engine', 'pack_loader', 'pack-registry.mjs'));
  const packs = await loadPacks({ localRoot: projectRoot });
  return packs.filter((p) => isActive(p, { packs: declared }));
}

function loadedSkills(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return [];
  try { return skillLoads(parseEntries(readFileSync(transcriptPath, 'utf8'))); } catch { return []; }
}

const FILE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);

async function guardFileTool(payload) {
  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const path = targetPath(payload, projectRoot);
  if (!path) return;
  const declarations = pathScopedSkills(await activePacks(projectRoot));
  if (!declarations.length) return;
  const missing = missingSkillsFor(path, declarations, loadedSkills(payload.transcript_path));
  if (!missing.length) return;
  const names = missing.map((d) => d.skill);
  hooklog('PreToolUse', `done exit=2 skill-not-loaded ${path} needs ${names.join(',')}`);
  // Reading the skill's own file is a load too (the transcript reader counts it), so
  // the message carries that path beside the Skill call.
  const skillFile = (d) => relative(projectRoot, join(d.dir, 'SKILL.md')).split(sep).join('/');
  process.stderr.write(
    `Blocked: ${path} is edited only with the ${names.map((n) => `\`${n}\``).join(' and ')} skill loaded `
    + `(the ${[...new Set(missing.map((d) => d.pack))].join(', ')} pack's skill forces itself for ${missing.map((d) => d.files).join(', ')}). `
    + `Load it first — Skill tool, ${names.map((n) => `skill: "${n}"`).join(', ')}, or Read ${missing.map(skillFile).join(' or ')} — then retry the edit.`,
  );
  process.exit(2);
}

let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  let payload = {};
  try { payload = JSON.parse(input); } catch { /* no payload → allow */ }
  if (FILE_TOOLS.has(payload.tool_name)) {
    // A guard that cannot decide lets the edit through: an unreadable declaration
    // or registry is the mount self-test's finding, never a session wedged on edits.
    guardFileTool(payload).then(() => process.exit(0), (e) => {
      hooklog('PreToolUse', `done exit=0 skill-guard-failed ${e?.message ?? e}`);
      process.exit(0);
    });
    return;
  }
  if (payload.tool_name !== 'Bash') process.exit(0);
  const cmd = payload.tool_input?.command ?? '';
  const deletesRemoteBranch =
    /\bgit\s+push\b[^\n;&]*\s(--delete|-d)\s/.test(cmd) ||
    /\bgit\s+push\b[^\n;&]*\s\S+\s+:\S/.test(cmd);
  if (deletesRemoteBranch) {
    // Log only the block — the interesting event. An allowed command every Bash
    // call would flood the log and drown the SessionStart signal it exists for.
    hooklog('PreToolUse', 'done exit=2 blocked-remote-branch-delete');
    process.stderr.write(
      'Blocked: never delete a remote branch — a current environment bug makes the delete-push fail, so it cannot succeed. Leave the branch; it can be deleted from the GitHub UI if needed.'
    );
    process.exit(2);
  }
  process.exit(0);
});
