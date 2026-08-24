// COMPATIBILITY SHIM — the slot scheduler is deleted (#974) and nothing here
// schedules anything. This path exists for the same reason `slots.mjs` beside it
// does, and that file's header carries the full reasoning: the engine lane and the
// pack lane deliver separately, so a member holds the new engine beside an old pack
// for a while, and a fielded pack version still imports this path. Deleting it
// outright broke a member's converge (#1004).
//
// WHAT IS HERE. Only the symbols a fielded pack version imports, each pointing at
// the module that owns it now. Which those are is derived from history by
// `packs/claudinite-tasks/test/engine-pack-lane-shims.test.mjs`, not listed here.
//
// WHEN IT GOES. When no member's stamped `packVersions` names a version that still
// imports this path — read the field, do not guess a release.
export { ensureLabels } from './github.mjs';

// The one body that cannot re-export: its home is now a PACK, and the engine may
// not import a pack. So it is duplicated, and the shim test is the drift guard —
// it runs both copies over the same inputs rather than comparing their text.
//
// `A=1,B=2`, newline-separated, or bare `A` (⇒ `'true'`). Values stay STRINGS with
// no truthiness coercion, which is the shape a fielded worker expects.
export function parseOverrides(raw) {
  const out = {};
  for (const part of String(raw ?? '').split(/[,\n]/)) {
    const token = part.trim();
    if (!token) continue;
    const eq = token.indexOf('=');
    if (eq === -1) out[token] = 'true';
    else out[token.slice(0, eq).trim()] = token.slice(eq + 1).trim();
  }
  return out;
}
