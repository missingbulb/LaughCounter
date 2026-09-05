import {
  normalizeEdges, barrierFindings, staleFindings, specFinding,
} from '../../../engine/checks/helpers/reference-scanning.mjs';
import { DEFAULT_DOC } from '../barriers.mjs';

// The project-declared barrier check: a repo states its folder-access graph as
// `config.barriers.rules` on its basics pack entry in .claudinite-settings.json
// (the loader overlays each pack entry's `config` onto `packConfig`), and this
// enforces it. A rule owns its exceptions — carve-out strings and reviewed
// { path, to?, reason } crossings both live in the rule's own `except`, so a NEW
// coupling in an already-reviewed file still fails and paid-down debt goes stale.
// (A pack that ships a *fixed* barrier contributes it as manifest data instead —
// barriers.mjs beside this file builds those.)
const rule = {
  id: 'barrier',
  severity: 'blocking',
  doc: DEFAULT_DOC,
  description: "Folders must not reference across a declared barrier (the basics pack entry's config.barriers)",
  why: 'a declared folder barrier encodes an architectural boundary; a crossing reference erodes it silently',

  run(ctx) {
    // The graph moved onto the basics entry when the barriers pack was absorbed
    // into this one (#1681). A member reading its own OLD declaration is the
    // window between its mount converging and the record rewriting its
    // declaration, which #1041 showed can be more than one cycle: the fallback is
    // what keeps that member's graph enforced instead of silently unenforced.
    // `legacy-shape-in-use` is the advisory that reaches the holder — the same
    // finding names the entry, and the same edit fixes both shapes.
    // @legacy-tolerance advisory:legacy-shape-in-use retire:#1682
    const cfg = ctx.config?.packConfig?.basics?.barriers ?? ctx.config?.packConfig?.barriers;
    if (cfg === undefined || cfg === null) return []; // no graph declared — nothing to enforce
    if (typeof cfg !== 'object' || Array.isArray(cfg) || !('rules' in cfg)) {
      return [specFinding(rule, {
        what: 'the barriers config must be an object with a "rules" array',
        fix: 'set { "packs": [ { "id": "basics", "config": { "barriers": { "rules": [ { "from": "...", "to": "..." } ] } } } ] }',
      })];
    }
    const out = [];
    const unknown = Object.keys(cfg).filter((k) => k !== 'rules');
    if (unknown.length) {
      out.push(specFinding(rule, {
        what: `the barriers config has unknown ${unknown.length > 1 ? 'properties' : 'property'} ${unknown.map((k) => `"${k}"`).join(', ')} — exceptions live per-rule now, in each rule's "except"`,
        fix: 'it takes only "rules"; move accept/except entries into the owning rule\'s "except"',
      }));
    }
    const { edges, errors } = normalizeEdges(cfg.rules);
    out.push(...errors.map((e) => specFinding(rule, e)));

    const { findings, stale } = barrierFindings(ctx, edges, rule);
    out.push(...findings);

    // Staleness is trustworthy only on a whole-repo sweep with a clean config: a
    // --changed run sees only part of the findings, and any config/scan error
    // means the scan was incomplete.
    const scanErrors = findings.some((f) => f.resolved === undefined);
    if (ctx.mode === 'all' && !unknown.length && !errors.length && !scanErrors) {
      out.push(...staleFindings(stale, rule));
    }
    return out;
  },
};

export default rule;
