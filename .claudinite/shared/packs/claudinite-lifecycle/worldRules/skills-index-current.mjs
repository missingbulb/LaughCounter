import { finding } from '../../../engine/checks/helpers/findings.mjs';
import { packEntryId } from '../../../engine/pack_loader/pack-registry.mjs';
import * as index from '../../../engine/pack_loader/generate-skills-index.mjs';

// The sibling of rules-index-current for the skills index: the converge writes it,
// and a repo whose converge has stopped, or that declared a pack since its last
// refresh, carries a catalog that no longer names what is mounted. Asked from the
// repo's own files, as rules-index-current is (a rule cannot await the generator):
// is there an index, and does it name every skill a declared pack holds here.
const SKILLS_INDEX_FILE = '.claudinite/claudinite-skills.GENERATED.md';

const rule = {
  id: 'skills-index-current',
  severity: 'blocking',
  description: `${SKILLS_INDEX_FILE} must exist and name every skill the declared packs bundle`,
  doc: 'engine/pack_loader/generate-skills-index.mjs',
  why: 'the index is the one readable answer to which skill loads when — a stale one sends a reader, and a session whose edit was held, to a skill that is not there or past one that is',

  run(ctx) {
    if (typeof index.SKILLS_INDEX_FILE !== 'string') return []; // an engine that predates the index
    const declared = Array.isArray(ctx.config?.packs) ? ctx.config.packs : [];
    // RELEVANCE FIRST: the skills the declared packs HOLD here, by the tree — a pack
    // whose files are not vendored yet is the unknown-pack error's finding, not this.
    const held = [];
    for (const id of declared.map(packEntryId).filter(Boolean)) {
      for (const root of [`.claudinite/shared/packs/${id}`, `packs/${id}`, `.claudinite/local/packs/${id}`]) {
        for (const f of ctx.tracked) {
          const m = new RegExp(`^${root.replace(/[.]/g, '\\.')}/skills/([^/]+)/SKILL\\.md$`).exec(f);
          if (m) held.push(m[1]);
        }
      }
    }
    if (!held.length) return [];
    const regenerate = 'run `node .claudinite/shared/engine/pack_loader/generate-skills-index.mjs --write` (canon-side: `node engine/pack_loader/generate-skills-index.mjs --write`) and commit the result';
    const text = ctx.read(SKILLS_INDEX_FILE);
    if (text === null) {
      return [finding(rule, { file: SKILLS_INDEX_FILE, what: 'the skills index is missing', fix: regenerate })];
    }
    const out = [];
    for (const skill of new Set(held)) {
      if (!text.includes(`\`${skill}\``)) {
        out.push(finding(rule, { file: SKILLS_INDEX_FILE, what: `the skill "${skill}" is mounted from a declared pack but the skills index does not name it`, fix: regenerate }));
      }
    }
    return out;
  },
};

export default rule;
