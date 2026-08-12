import { finding } from '../../engine/checks/helpers/findings.mjs';

const LIMIT = 100;
const RULES_MD = /(^|\/)RULES\.md$/;

// Byte length, not character count: an em dash costs three bytes, and a rule
// file is full of them, so counting characters lets a line render past the
// column a reviewer's editor wraps at.
const tooLong = (line) => Buffer.byteLength(line) > LIMIT;

// A rule file is read in a diff, in a terminal and in a session transcript,
// none of which soft-wrap the way an editor does. A bullet held on one physical
// line is one unreviewable blob: the diff marks the whole rule changed when a
// single word moved, and nothing points at which clause it was.
const rule = {
  id: 'rules-line-length',
  severity: 'advisory',
  description: `A RULES.md line over ${LIMIT} bytes is one unreviewable blob in a diff`,
  doc: 'packs/basics/RULES.md',
  why: 'a rule changed one word at a time still shows as a whole-paragraph diff when its bullet is one physical line',

  run(ctx) {
    const findings = [];
    for (const file of ctx.files.filter((f) => RULES_MD.test(f))) {
      const text = ctx.read(file);
      if (text === null) continue;
      const over = text.split('\n')
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => tooLong(line));
      if (!over.length) continue;
      findings.push(finding(rule, {
        file,
        line: over[0].n,
        what: `${over.length} line(s) over ${LIMIT} bytes, longest ${Math.max(...over.map(({ line }) => Buffer.byteLength(line)))}`,
        fix: `wrap the prose at ${LIMIT} columns — a Markdown bullet continues on an indented line, so the rendering is unchanged`,
      }));
    }
    return findings;
  },
};

export default rule;
