import { finding } from '../../../engine/checks/helpers/findings.mjs';
import { isActive } from '../../../engine/pack_loader/pack-registry.mjs';
// Namespace imports with a capability probe, not named ones: the pack and engine
// lanes deliver on their own cadences, and a member holding this pack beside an
// engine that predates the helper must load the pack rather than fault it.
import * as transcript from '../../../engine/checks/helpers/session-transcript.mjs';
import * as scoped from '../../../engine/pack_loader/path-scoped-skills.mjs';

// The Stop-time half of path-scoped skills. The PreToolUse guard stops a file
// tool before the first edit under a scoped pattern; this catches the edits it
// never sees — a `sed`, a heredoc, a script — by asking the same question of the
// diff: did the session load the skill each changed path is scoped to.
const rule = {
  id: 'skill-loaded-before-editing',
  severity: 'blocking',
  description: 'A file a skill forces itself for (force-load-on-file-edits-paths) changed, or a tool call one forces itself for (force-load-on-tool-calls) ran, in a session that never loaded that skill',
  doc: 'engine/pack_loader/path-scoped-skills.mjs',
  scope: 'work',
  why: 'the pack scoped those files to a skill because editing them without it produces work the skill would have prevented; a load after the fact is the review the skill was meant to spare',

  run(work) {
    if (typeof scoped.pathScopedSkills !== 'function' || typeof transcript.skillLoads !== 'function') return [];
    const entries = work.conversation().entries;
    if (!entries || !entries.length) return []; // CI and manual runs carry no transcript
    const active = work.packs.filter((p) => isActive(p, work.config));
    const declarations = scoped.pathScopedSkills(active);
    // Session-wide where the engine offers it — a subagent's load lands only in
    // its own transcript — the session file alone on an engine that predates it.
    const loaded = typeof work.skillLoads === 'function' ? work.skillLoads() : transcript.skillLoads(entries);
    const out = [];
    for (const file of declarations.length ? work.changedFiles : []) {
      for (const d of scoped.missingSkillsFor(file, declarations, loaded)) {
        out.push(finding(rule, {
          file,
          what: `changed under ${d.files}, which the ${d.pack} pack's \`${d.skill}\` skill forces itself for, and this session never loaded that skill`,
          fix: `load it now — Skill tool, skill: "${d.skill}", or Read its SKILL.md — and re-read the change against what it says before stopping`,
        }));
      }
    }
    // The tool-call half: a call a skill forces itself for, in a session that
    // never loaded it. Judged against the whole session's loads like the path
    // half — the PreToolUse guard holds the call until the load, and what is left
    // for Stop is the session that loaded it never; a load now, with the re-read
    // the fix asks for, is what converges the finding.
    if (typeof scoped.triggeredSkills === 'function' && typeof work.toolCalls === 'function') {
      const triggers = scoped.triggeredSkills(active).filter((d) => d.kind === 'toolCall');
      const reported = new Set();
      for (const call of triggers.length ? work.toolCalls() : []) {
        for (const d of scoped.missingSkillsForCall(call, triggers, loaded)) {
          if (reported.has(d.skill)) continue;
          reported.add(d.skill);
          out.push(finding(rule, {
            file: `(session) ${call.name} call`,
            what: `a ${call.name} call the ${d.pack} pack's \`${d.skill}\` skill forces itself for (${d.source}) ran, and this session never loaded that skill`,
            fix: `load it now — Skill tool, skill: "${d.skill}", or Read its SKILL.md — and re-read what the call did against what it says before stopping`,
          }));
        }
      }
    }
    return out;
  },
};

export default rule;
