import { finding } from '../../../engine/checks/helpers/findings.mjs';
import { resolveStore, isUsableIdentity } from '../store.mjs';

// A person's preferences file is addressed by their IDENTITY and nothing else:
// store.mjs builds `<path>/<email>.md` from CLAUDE_CODE_USER_EMAIL, and
// session-start.mjs reads exactly that path (locally when this tree is the store, over
// raw.githubusercontent.com otherwise). There is no index, no registry and no fallback
// — a file whose name is not a usable identity plus `.md` is simply never opened by
// anyone.
//
// And nothing says so. Every miss on the reading side is fail-soft on purpose: no
// identity, no store, no file, a failed fetch — each is one note in the session context
// and the session carries on with default behavior. So a preferences file named
// `ariel.md`, or `Ariel@Gmail.com.md` for an identity the harness supplies in lower
// case, or parked in a subdirectory, looks perfectly fine in the tree and is dead. The
// person notices only by the absence of behavior they were expecting.
//
// THIS IS A PROPERTY OF BEING A STORE, not of any one fleet's store repo, which is why
// it sits here beside store.mjs rather than in the store repo's own local pack: it
// imports the reader's `resolveStore`/`isUsableIdentity` as siblings, so the check can
// never be stricter or looser than the code that does the opening.
//
// ADVISORY, matching its sibling store-configured.mjs for the same reason: the loss is
// a nicety, no other check or task depends on it, and the fix is a rename.
//
// RELEVANCE-FIRST. It is inert unless this repo actually carries the store directory
// its own declaration names — which is every member of a fleet: they declare the pack
// to READ a store that lives somewhere else. Only the one repo that IS the store has
// files to judge.
const PACK = 'claude-code-web-users-support';

const rule = {
  id: 'preferences-store-file-names',
  severity: 'advisory',
  description: 'Every file in a preferences store this repo holds is README.md or <identity>.md',
  doc: 'packs/claude-code-web-users-support/RULES.md',
  why: 'the reader addresses a person\'s file as <path>/<email>.md and fails soft on a miss, so a differently-named file is never opened and nothing ever reports it',

  // `ctx.files` is the tracked, non-vendored set — the store is committed content, and
  // an uncommitted file is not published to the fleet yet anyway.
  run(ctx) {
    const store = resolveStore(ctx.config.packConfig?.[PACK] ?? null);
    if (!store) return []; // no usable store declared — store-configured reports that

    const prefix = `${store.path}/`;
    const held = (ctx.files ?? []).filter((f) => f.startsWith(prefix));
    if (!held.length) return []; // this repo is not the store, whatever it points at

    return held.flatMap((f) => {
      const rest = f.slice(prefix.length);
      if (rest.includes('/')) {
        return [finding(rule, {
          file: f,
          what: `sits in a subdirectory of ${store.path}/ — a person's file is only ever addressed as ${store.path}/<email>.md`,
          fix: `move it to ${store.path}/<email>.md, or out of the store entirely if it is not one person's preferences`,
        })];
      }
      if (rest === 'README.md') return []; // the store's own doc, deliberately not an identity
      const identity = rest.endsWith('.md') ? rest.slice(0, -3) : null;
      if (identity !== null && isUsableIdentity(identity)) return [];
      return [finding(rule, {
        file: f,
        what: `is not named for a usable identity — the reader opens ${store.path}/<email>.md and nothing else`,
        fix: 'rename it to the person\'s exact CLAUDE_CODE_USER_EMAIL plus ".md" (case included — the fleet fetches it as a URL path segment), or delete it',
      })];
    });
  },
};

export default rule;
