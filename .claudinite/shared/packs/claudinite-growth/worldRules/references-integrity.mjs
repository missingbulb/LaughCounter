import { finding } from '../../../engine/checks/helpers/findings.mjs';

// The integrity half of the writing-pack-prose references convention: a rule in
// a pack's prose ends with a bare `(n)` marker citing an entry in the pack's
// own references.md, and a `check:` entry there names a check the pack still
// carries. Both sides fail silently without this — a dangling marker cites a
// rationale nobody recorded, and an orphaned check entry lets a future
// revalidation reaffirm a check that no longer exists — so the cross-file
// resolution is machine-held here; what the convention *means* stays in the
// writing-pack-prose skill.
//
// Two-root form: the path pattern keys on the `packs/<pack>/` suffix, so it
// matches the canon home's `packs/` and a member's `.claudinite/local/packs/`
// alike (a member's vendored `.claudinite/shared/` copy is linguist-vendored and
// never in the file set).
//
// RELEVANCE FIRST (engine/checks/README.md): the convention is opt-in per rule,
// so a pack with no markers and no check entries produces nothing.
const PROSE = /(^|\/)packs\/[^/]+\/(?:RULES\.md|skills\/[^/]+\/SKILL\.md)$/;
const PACK_DIR = /(^|.*\/)packs\/[^/]+\//;

// A citation marker: a line ENDING with `(3)` or `(3, 7)` — an inline issue id
// `(#1119)` or a worded parenthetical never matches, and a trailing period puts
// the marker after it by convention. A marker resolves within its own file's
// namespace: `(3)` in RULES.md cites the `RULES-3` entry, in a skill the
// `<skill-name>-3` entry.
const MARKER = /\((\d+(?:\s*,\s*\d+)*)\)\s*$/;
const ENTRY = /^\s*-\s+\*\*\(([A-Za-z][\w-]*-\d+)\)\*\*/;
const CHECK_ENTRY = /^\s*-\s+\*\*\(check:([\w/-]+)\)\*\*/;

// A check id as pack files spell it: declared-checks.json's `"id": "x"` or a
// coded rule module's `id: 'x'` — a pack-prefixed id (`aws-sam/handler-path`)
// carries a slash.
const CHECK_IDS = /\bid['"]?\s*:\s*['"]([\w/-]+)['"]/g;

const rule = {
  id: 'references-integrity',
  severity: 'blocking',
  since: '2026-09-01',
  description: 'Every (n) rationale marker in pack prose resolves to an entry in that pack\'s references.md, and every check: entry there names a check the pack still carries',
  doc: 'packs/claudinite-growth/skills/writing-pack-prose/SKILL.md',
  why: 'the references doc is what a periodic review reaffirms rules and checks against — a dangling marker cites a rationale nobody recorded, and an orphaned check entry lets a review reaffirm a check that no longer exists',

  run(ctx) {
    const out = [];
    const entriesOf = new Map(); // pack dir -> Set of entry numbers, or null when no references.md

    const entries = (packDir) => {
      if (!entriesOf.has(packDir)) {
        const text = ctx.read(`${packDir}references.md`);
        entriesOf.set(packDir, text === null
          ? null
          : new Set(text.split('\n').map((l) => ENTRY.exec(l)?.[1]).filter(Boolean)));
      }
      return entriesOf.get(packDir);
    };

    for (const file of ctx.files) {
      if (!PROSE.test(file)) continue;
      const text = ctx.read(file);
      if (text === null) continue;
      const packDir = PACK_DIR.exec(file)[0];
      // The file's entry namespace: RULES for RULES.md, the skill's own name
      // for a skills/<name>/SKILL.md.
      const stem = file.endsWith('/RULES.md') || file === 'RULES.md'
        ? 'RULES'
        : file.split('/').at(-2);
      for (const line of text.split('\n')) {
        const m = MARKER.exec(line);
        if (!m) continue;
        const known = entries(packDir);
        for (const n of m[1].split(',').map((s) => s.trim())) {
          const key = `${stem}-${n}`;
          if (known === null) {
            out.push(finding(rule, {
              file,
              what: `cites rationale entry (${n}) but the pack has no references.md`,
              fix: `add ${packDir}references.md with a "- **(${key})** <reason>" entry, or drop the marker — the writing-pack-prose skill owns the convention`,
            }));
          } else if (!known.has(key)) {
            out.push(finding(rule, {
              file,
              what: `cites rationale entry (${n}), which ${packDir}references.md does not carry as ${key}`,
              fix: `add the "- **(${key})** <reason>" entry, or drop the marker; entry numbers are stable identifiers, so a removed entry's number is never reused`,
            }));
          }
        }
      }
    }

    // The reverse direction: check entries against the checks the pack carries.
    for (const file of ctx.files) {
      if (!/(^|\/)(?:local_)?packs\/[^/]+\/references\.md$/.test(file)) continue;
      const text = ctx.read(file);
      if (text === null) continue;
      const packDir = PACK_DIR.exec(file)[0];
      const cited = text.split('\n').map((l) => CHECK_ENTRY.exec(l)?.[1]).filter(Boolean);
      if (!cited.length) continue;
      const ids = new Set();
      for (const f of ctx.files) {
        if (!f.startsWith(packDir) || !/\.(mjs|json)$/.test(f)) continue;
        for (const m of (ctx.read(f) ?? '').matchAll(CHECK_IDS)) ids.add(m[1]);
      }
      for (const id of cited) {
        if (ids.has(id)) continue;
        out.push(finding(rule, {
          file,
          what: `carries a rationale entry for check:${id}, which the pack does not carry`,
          fix: 'remove the entry with the check it explained, or point it at the check\'s current id',
        }));
      }
    }
    return out;
  },
};

export default rule;
