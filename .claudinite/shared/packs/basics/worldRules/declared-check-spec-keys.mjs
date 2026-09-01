import { finding } from '../../../engine/checks/helpers/findings.mjs';
// A NAMESPACE import, and the guard below, because the two lanes deliver on
// separate cycles: a member takes this pack version nightly and the engine only
// on a release, so a window exists where this file sits beside an engine with no
// `unplacedSpecKeys` to export. A named import of an absent export is a link-time
// SyntaxError, which the loader records as a fault, which fails the self-test,
// which parks the converge — #1400's own wedge, from the other lane.
import * as patternRules from '../../../engine/checks/helpers/pattern-rules.mjs';

// A declared check's keys ARE its vocabulary: write `scanFile` for `scanFiles`
// and the assertion the key carried is simply not there, asserting nothing and
// reading green forever. The load used to throw on such a key; it now drops it,
// because a key it cannot place is equally a key a NEWER engine knows and
// refusing it wedges the member holding an older one (#1400, pattern-rules.mjs).
// This rule is where the typo half is caught instead — advisory by default,
// because in a member either reading is possible, and overridden to blocking in
// the canon, where engine and declarations ship from one commit so a key the
// engine cannot place can only be a typo.
//
// Coded rather than declared: the assertion is "every key, at every level, is in
// its own container's allowlist", which is a recursive descent against a
// per-container vocabulary the declaration language cannot express — and the
// vocabulary itself is the engine's, read from it here rather than restated.
const DECLARED = /(^|\/)declared-checks\.json$/;

// The unplaceable keys of one declaration, or none from an engine that predates
// the split. That engine still throws on such a key at load, so the silence
// costs nothing: it is the pre-#1400 behaviour, and this rule starts reporting
// the moment the engine release carrying the export arrives.
export function unplacedKeysWith(engine, spec) {
  return typeof engine.unplacedSpecKeys === 'function' ? engine.unplacedSpecKeys(spec) : [];
}

const rule = {
  id: 'declared-check-spec-keys',
  severity: 'advisory',
  description: 'Every key in a declared check is one the engine\'s vocabulary places',
  why: 'a key the engine cannot place is dropped at load, so a typo\'d key asserts nothing at all and its check reads green forever',

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
        const anchor = text.slice(0, text.indexOf(`"${spec.id}"`)).split('\n').length;
        for (const { key, container, allowed } of unplacedKeysWith(patternRules, spec)) {
          out.push(finding(rule, {
            file,
            line: anchor,
            what: container === 'spec'
              ? `"${spec.id}" carries "${key}", which is not a spec key — the vocabulary here is: ${allowed.join(', ')}`
              : `"${spec.id}" carries "${key}" inside "${container}", whose keys are: ${allowed.join(', ')}`,
            fix: `spell the key the engine has, or drop it — unless it belongs to a newer engine, which this mount will place once its version arrives`,
          }));
        }
      }
    }
    return out;
  },
};

export default rule;
