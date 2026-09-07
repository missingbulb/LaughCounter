// A NAMESPACE import for the same reason the sibling spec-keys rule takes one: the
// pack and the engine deliver on separate cycles, so this file can sit beside an
// engine whose findings helper predates `graceUntil`, and a named import of an
// absent export is a link-time SyntaxError that faults the whole pack.
import * as findings from '../../../engine/checks/helpers/findings.mjs';

// An `action` check is re-judged over the WHOLE session transcript at Stop, so a
// blocking one that lands mid-session convicts calls the session made before it
// existed — and a past tool call has no clearing move, so that finding blocks every
// Stop for the rest of the session. `since` is the corpus's answer: it buys the new
// check a grace window in which it reports without blocking. Absence means "mature,
// never newborn" (findings.mjs), which is right for the standing corpus and wrong
// for every check added from here on — this rule is what makes the dating happen at
// the moment the declaration is written.
//
// Coded rather than declared: the assertion is over one spec object's shape — two
// keys present, a third absent — which the declaration language's line matching
// cannot express without reading the neighbouring lines it has no access to.
const DECLARED = /(^|\/)declared-checks\.json$/;

// Whether a declared `since` actually buys grace, asked of the engine that grants
// it rather than restated here. An engine without the export cannot grant grace to
// anyone, so any date reads as good and the rule falls back to demanding one.
function datesTheCheck(since) {
  if (typeof findings.graceUntil === 'function') return findings.graceUntil(since) !== null;
  return typeof since === 'string' && since.trim() !== '';
}

const rule = {
  id: 'declared-check-since',
  severity: 'blocking',
  // Dated on its own terms: a member holding an undated blocking action check reads
  // this the moment it converges, and the remedy is theirs to write.
  since: '2026-09-06',
  description: 'Every blocking action-scope check carries a `since` date the grace window can read',
  why: 'a blocking action check with no usable `since` convicts the tool calls a session made before the check existed, and a past call has no clearing move',

  run(ctx) {
    const out = [];
    for (const file of ctx.files.filter((f) => DECLARED.test(f))) {
      const text = ctx.read(file);
      if (text === null) continue;
      let specs;
      try { specs = JSON.parse(text); } catch { continue; } // unparsable is the loader's finding
      if (!Array.isArray(specs)) continue;
      for (const spec of specs) {
        if (!spec || typeof spec !== 'object' || typeof spec.id !== 'string') continue;
        if (spec.scope !== 'action' || spec.severity !== 'blocking') continue;
        if (datesTheCheck(spec.since)) continue;
        const anchor = text.slice(0, text.indexOf(`"${spec.id}"`)).split('\n').length;
        out.push(findings.finding(rule, {
          file,
          line: anchor,
          what: spec.since === undefined
            ? `"${spec.id}" blocks on tool calls and carries no "since"`
            : `"${spec.id}" blocks on tool calls and its "since" of "${String(spec.since).slice(0, 30)}" is not a YYYY-MM-DD date`,
          fix: 'add "since": the YYYY-MM-DD date this check lands, so its first two weeks report without blocking the sessions that predate it',
        }));
      }
    }
    return out;
  },
};

export default rule;
