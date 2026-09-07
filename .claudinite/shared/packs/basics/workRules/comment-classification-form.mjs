import { finding } from '../../../engine/checks/helpers/findings.mjs';
import { classificationLine, classesIn } from '../../../engine/checks/helpers/session-transcript.mjs';

// Sharpens comment-classification (which only checks a `Comment class:` line
// EXISTS) with the form RULES.md already demands: the class alone on its own
// line, any explanation on the next one. `classesIn()` — the same helper every
// classification-gated rule reads — matches every class token ANYWHERE on the
// line, so an explanation sharing that line declares whatever it happens to
// mention, not what the author meant to say.
//
// This asserts the FORM, not the author's intent, and it has to: a check that
// instead hunted for a class token following a negation word ("not", "never",
// "besides", …) stays silent on real replies that smuggle a class anyway —
//     Comment class: other — unrelated to any feature request      (declares feature)
//     Comment class: other, setting the feature question aside     (declares feature)
//     Comment class: correction | feature | process-change | other (declares all four,
//                                                          the menu pasted verbatim)
// The harm is a class token being PRESENT on the line, not negated, so only
// checking that the line's content IS the declaration — and nothing else —
// catches all three with no word list to keep current. A genuinely mixed
// comment stays legal and stays silent: it names each part it really is,
// positively, comma-separated, on that one line (`Comment class: correction,
// process-change`). Markdown emphasis around the bare declaration
// (`**Comment class: other**`) is tolerated, matching the leading decoration
// classificationLine() already allows.
//
// ADVISORY, deliberately, where the underlying defect is blocking-grade
// elsewhere: the transcript this rule reads is append-only, so by the time a
// malformed line is observable it cannot be retracted, and a blocking finding
// here could never converge — it would spend every Stop cycle on something no
// edit can fix. Its job is only to name the cause the moment it appears, so a
// session doesn't have to re-derive it from an unrelated downstream failure.

const CLASS = String.raw`(?:correction|feature|process[\s-]change|other)`;
// `|` is deliberately not a separator — it's how a menu is written out, so
// pasting the menu verbatim fails this pattern instead of reading as a
// four-class declaration.
const CONFORMING_RE = new RegExp(String.raw`^${CLASS}(?:\s*(?:,|&|\+|and)\s*${CLASS})*\.?$`, 'i');

function bareDeclaration(text) {
  return text.trim().replace(/^[*_]+|[*_]+$/g, '').trim();
}

const rule = {
  id: 'comment-classification-form',
  severity: 'advisory',
  description: 'The `Comment class:` line must carry the class alone — every class token on it is declared, however the line phrases them',
  doc: 'packs/basics/RULES.md',
  scope: 'work',
  why: 'classesIn() matches every class token anywhere on the classification line, so an explanation sharing that line declares whatever it happens to mention, not just what the author meant',

  run(work) {
    const turn = work.conversation().ownerTurns().last();
    if (!turn.exists) return [];
    const line = classificationLine(turn.reply());
    if (!line) return []; // no classification line at all — comment-classification's finding, not this one

    const declaration = bareDeclaration(line.slice(line.indexOf(':') + 1));
    if (CONFORMING_RE.test(declaration)) return [];

    const declared = [...classesIn(line)].sort();
    if (!declared.length) return []; // names no class at all — comment-classification's finding, not this one

    return [finding(rule, {
      file: '(conversation)',
      what: `the \`Comment class:\` line carries more than the class it means, so it is read as declaring ${declared.map((c) => `\`${c}\``).join(', ')}`,
      fix: 'write the class alone on its own line, and put any explanation on the NEXT line; a genuinely mixed comment names each part it really is, comma-separated, on that one line. The transcript is append-only, so a clean re-declaration further down does not override this one',
    })];
  },
};

export default rule;
