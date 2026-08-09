// "A class-identifier keyword that isn't lowercase silently never matches", as a
// check.
//
// `LaughDetector` classifies each window by *substring stem* against Apple's
// built-in taxonomy — deliberately, because the classifier emits gerunds
// ("giggling"), so "giggle" would miss it and "giggl" catches both. The match is
// done against a lowercased identifier:
//
//     let id = c.identifier.lowercased()
//     if Self.laughKeywords.contains(where: { id.contains($0) })
//
// So a keyword carrying any uppercase letter — "Applause", "Chortling" — can never
// match anything, and it fails *silently*: no error, no warning, just a class of
// laughs (or of TV context, which decides you-vs-TV attribution, #7) that stops
// being recognised. This check catches that the day the keyword lands.
//
// Dependency-free by design (a local pack must load without the canon mount), so
// the finding objects are built by hand rather than via the engine helper.

// The keyword lists matched against a lowercased class identifier. Matched by
// name so a new list (a fourth taxonomy bucket) is covered the day it is added.
const LIST = /\b(?:let|var)\s+(\w*[kK]eywords)\s*(?::\s*\[String\]\s*)?=\s*\[([^\]]*)\]/g;
const LITERAL = /"([^"\\]*)"/g;

const inScope = (f) => f.startsWith('mac/Sources/') && f.endsWith('.swift');

const rule = {
  id: 'laugh-detection/classifier-keywords-lowercase',
  severity: 'blocking',
  description: 'Sound-class keywords are lowercase stems — the identifier is lowercased before matching (mac/Sources/)',
  doc: '.claudinite/local/packs/laugh-detection/RULES.md',
  why: 'the match runs against `identifier.lowercased()`, so a keyword with a capital in it can never fire — a laugh class or a TV-context class silently stops being recognised, with no error to notice',

  run(ctx) {
    const out = [];
    for (const file of ctx.files.filter(inScope)) {
      const text = ctx.read(file);
      if (text === null) continue;
      LIST.lastIndex = 0;
      let list = LIST.exec(text);
      while (list !== null) {
        const [, name, body] = list;
        LITERAL.lastIndex = 0;
        let lit = LITERAL.exec(body);
        while (lit !== null) {
          const word = lit[1];
          if (word !== word.toLowerCase()) {
            const index = list.index + list[0].indexOf(body) + lit.index;
            out.push({
              rule: rule.id,
              severity: rule.severity,
              file,
              line: text.slice(0, index).split('\n').length,
              what: `${name} contains "${word}", which is not lowercase`,
              why: rule.why,
              fix: `write it as the lowercase stem — "${word.toLowerCase()}" — and prefer the shortest stem that covers the taxonomy's inflections ("giggl" matches both "giggle" and "giggling")`,
              doc: rule.doc,
            });
          }
          lit = LITERAL.exec(body);
        }
        list = LIST.exec(text);
      }
    }
    return out;
  },
};

export default rule;
