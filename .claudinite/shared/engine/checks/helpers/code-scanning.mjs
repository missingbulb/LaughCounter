// Helpers for checks that scan source *code* for a forbidden token (a banned
// API, an impure import, a DOM specific). Such a check must see code, not
// prose: a comment or a doc-string that merely *names* `chrome.storage` or
// `fetch(` is describing the code, not doing it, and matching it is a false
// positive that fails the build over an English sentence. Strip comments first.

// Return `source` with its JS/TS comments removed, leaving everything else —
// including string and template literals — byte-for-byte intact. String-aware
// on purpose: a `//` inside "https://…" is not a comment, and dropping the rest
// of that line would corrupt real code (and could hide a genuine violation that
// follows on the same line). Regex literals are treated as code and preserved.
// Newlines inside block comments are kept so line numbers don't shift.
export function stripComments(source) {
  let out = '';
  let state = 'code'; // code | line | block | sq | dq | tpl
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    const c2 = source[i + 1];
    if (state === 'code') {
      if (c === '/' && c2 === '/') { state = 'line'; i++; continue; }
      if (c === '/' && c2 === '*') { state = 'block'; i++; continue; }
      if (c === "'") state = 'sq';
      else if (c === '"') state = 'dq';
      else if (c === '`') state = 'tpl';
      out += c;
    } else if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c; }
    } else if (state === 'block') {
      if (c === '*' && c2 === '/') { state = 'code'; i++; }
      else if (c === '\n') out += c;
    } else {
      // Inside a string/template literal: copy through until the matching quote,
      // honoring backslash escapes so an escaped quote doesn't end it early.
      out += c;
      if (c === '\\') { out += c2 ?? ''; i++; }
      else if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) {
        state = 'code';
      }
    }
  }
  return out;
}

// The extensions whose comments `stripComments` actually models. A file outside
// this set is never called comments-only: the parser cannot see its comments, so
// "nothing but comments changed" is a claim it has no grounds for, and answering
// "no" is the end that fails safe for both callers below.
export const COMMENT_CHECKABLE = new Set([
  '.mjs', '.cjs', '.js', '.jsx', '.ts', '.tsx', '.c', '.h', '.cc', '.cpp', '.hpp',
  '.java', '.go', '.swift', '.kt', '.dart', '.rs', '.cs', '.scss', '.css',
]);

// Did a change to `file` touch only its comments? `before`/`after` are the file's
// two contents, null where it was added or deleted — neither of which is a
// comment-only change, whatever the other side holds.
//
// Indentation and blank lines are ignored, so a whitespace-only edit inside a
// template literal reads as comments-only; in a language whose indentation is
// semantic the extension set above has already answered no.
//
// Its callers grant a PERMISSION on the answer — may this run land its own pull
// request unreviewed, may it have touched this file at all — which is why the safe
// end is "no" and why the answer lives here rather than in each of them.
export function commentOnly(file, before, after) {
  if (before == null || after == null) return false;
  const dot = file.lastIndexOf('.');
  const ext = dot === -1 ? '' : file.slice(dot).toLowerCase();
  if (!COMMENT_CHECKABLE.has(ext)) return false;
  const meat = (text) => stripComments(text).split('\n').map((l) => l.trim()).filter((l) => l !== '').join('\n');
  return meat(before) === meat(after);
}
