#!/usr/bin/env node
// The skills index: `.claudinite/claudinite-skills.GENERATED.md`, one readable table
// of every skill the repo's active packs bundle — canon and local alike — with what
// makes each one load: its description (the text the harness matches a session's
// activity against) and, for a path-scoped skill, the `force-load-on-file-edits-paths`
// its SKILL.md declares (the files the PreToolUse guard holds until it is loaded). The rules index beside
// it (generate-rules-index.mjs) is the channel a pack's PROSE reaches a session on;
// this one is a catalog for a reader — a person asking "which skill fires when", a
// session checking why an edit was held. It is not imported by CLAUDE.md: the harness
// already carries every mounted skill's description into the session prompt, and a
// second copy would spend context on what is there.
//
// Written by the same converge that writes the rules index, from the same registry
// answer (the union of the active packs' bundled skills, bundledSkillSources), so the
// two cannot name different pack sets.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadPacks, isActive, bundledSkillSources } from './pack-registry.mjs';
import { skillMetadata } from './skill-frontmatter.mjs';
import { settingsPath } from '../settings-file.mjs';

export const SKILLS_INDEX_FILE = join('.claudinite', 'claudinite-skills.GENERATED.md');

function declaredPacks(projectRoot) {
  const configPath = settingsPath(projectRoot);
  if (!existsSync(configPath)) return [];
  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf8'));
    return Array.isArray(raw.packs) ? raw.packs : [];
  } catch { return []; }
}

// One row per mounted skill, in mount order (the registry's: canon packs before
// local, a shared name resolving to canon): { skill, pack, description, paths }.
export function skillRows(active) {
  const sources = bundledSkillSources(active);
  const rows = [];
  for (const [skill, dir] of sources) {
    const pack = active.find((p) => (p.skills ?? []).includes(skill) && dir.startsWith(join(p.dir, 'skills')));
    const meta = skillMetadata(dir);
    rows.push({ skill, pack: pack?.id ?? '', description: meta.description, paths: meta.forceLoadPaths });
  }
  return rows;
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

// The index as text. Path-scoped skills first — they are the rows the guard acts on —
// then the rest, each group alphabetical, so the file reads as "these files, then
// these activities".
export function renderSkillsIndex(rows) {
  if (!rows.length) return null;
  const scoped = rows.filter((r) => r.paths.length).sort((a, b) => a.skill.localeCompare(b.skill));
  const rest = rows.filter((r) => !r.paths.length).sort((a, b) => a.skill.localeCompare(b.skill));
  const lines = [
    '<!-- GENERATED — do not hand-edit; every converge rewrites it. Edit a skill\'s SKILL.md frontmatter. -->',
    '# Skills mounted here, and what loads each one',
    '',
    'A skill loads when the session\'s activity matches its description. A skill that names files',
    'under `force-load-on-file-edits-paths` is also forced for them: a file tool aimed there is held',
    'by the PreToolUse guard until the skill is loaded (the Skill tool, or a Read of its SKILL.md),',
    'and an edit made another way is caught at Stop.',
    '',
  ];
  if (scoped.length) {
    lines.push('## Before editing these files', '', '| Files | Skill | Pack | Loads when |', '|---|---|---|---|');
    for (const r of scoped) lines.push(`| ${r.paths.map((p) => `\`${cell(p)}\``).join(', ')} | \`${r.skill}\` | ${r.pack} | ${cell(r.description)} |`);
    lines.push('');
  }
  if (rest.length) {
    lines.push('## By activity', '', '| Skill | Pack | Loads when |', '|---|---|---|');
    for (const r of rest) lines.push(`| \`${r.skill}\` | ${r.pack} | ${cell(r.description)} |`);
    lines.push('');
  }
  return `${lines.join('\n')}`;
}

export async function skillsIndexRows(projectRoot) {
  try {
    const packs = await loadPacks({ localRoot: projectRoot });
    return skillRows(packs.filter((pack) => isActive(pack, { packs: declaredPacks(projectRoot) })));
  } catch {
    return []; // fail soft — a broken loader must never block a converge
  }
}

export const skillsIndexContent = async (projectRoot) => renderSkillsIndex(await skillsIndexRows(projectRoot));

// Write the index if its content changed; a repo with no mounted skill leaves any
// existing file alone (its packs may simply not be vendored yet).
export async function writeSkillsIndex(projectRoot) {
  const content = await skillsIndexContent(projectRoot);
  if (content === null) return false;
  const path = join(projectRoot, SKILLS_INDEX_FILE);
  if (existsSync(path) && readFileSync(path, 'utf8') === content) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return true;
}

async function main() {
  const argv = process.argv.slice(2);
  const root = argv.find((a) => !a.startsWith('--')) || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (argv.includes('--write')) {
    console.log(await writeSkillsIndex(root) ? `wrote ${SKILLS_INDEX_FILE}` : `${SKILLS_INDEX_FILE} already current`);
    return;
  }
  process.stdout.write((await skillsIndexContent(root)) ?? '');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
