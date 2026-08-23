import { finding } from '../../../engine/checks/helpers/findings.mjs';

// A declared check IS its messages — the format carries no comments, no
// description and no doc pointer (#827), so what/fix/failureMessage are the
// whole teaching surface. That only works when each field stays one readable
// clause: the evidence, the one action, the one consequence. This meta-check
// keeps the spec files honest the way eslint-plugin-eslint-plugin lints
// ESLint's own rules — word caps per message field, and no fix string
// hand-repeated across one rule's assertions (the rule-level `fix` default
// exists precisely so a shared remedy is written once).
const DECLARED = /(^|\/)declared-checks\.json$/;
const MAX_WORDS = 32;
const MESSAGE_KEYS = new Set(['what', 'fix', 'failureMessage']);

const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;

// Every message-field string in one spec, with its key and whether it sits at
// the rule level (a rule-level fix is the dedup mechanism, never a duplicate).
function messageFields(node, atRuleLevel, out) {
  if (Array.isArray(node)) {
    for (const v of node) messageFields(v, false, out);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (MESSAGE_KEYS.has(key) && typeof value === 'string') {
      out.push({ key, value, atRuleLevel });
    } else {
      messageFields(value, false, out);
    }
  }
}

const rule = {
  id: 'declared-check-messages',
  severity: 'blocking',
  description: 'Every declared check\'s message fields stay within the word caps, with no fix repeated inside one rule',
  why: 'a declaration has no comments or doc pointer — its messages are the whole check, and a message that runs to a paragraph (or a remedy pasted per assertion) stops being readable as one',

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
        const fields = [];
        messageFields(spec, true, fields);
        for (const f of fields) {
          const n = words(f.value);
          if (n > MAX_WORDS) {
            out.push(finding(rule, {
              file,
              line: anchor,
              what: `"${spec.id}" has a ${f.key} of ${n} words (max ${MAX_WORDS}): "${f.value.slice(0, 60)}…"`,
              fix: 'cut the field to its one clause — the evidence in `what`, the single action in `fix`, the single consequence in `failureMessage`',
            }));
          }
        }
        const fixes = fields.filter((f) => f.key === 'fix' && !f.atRuleLevel).map((f) => f.value);
        const repeated = [...new Set(fixes.filter((v, i) => fixes.indexOf(v) !== i))];
        for (const value of repeated) {
          out.push(finding(rule, {
            file,
            line: anchor,
            what: `"${spec.id}" repeats one fix verbatim across ${fixes.filter((v) => v === value).length} assertions: "${value.slice(0, 60)}…"`,
            fix: 'state the shared remedy once as the rule-level "fix" and drop the per-assertion copies',
          }));
        }
      }
    }
    return out;
  },
};

export default rule;
