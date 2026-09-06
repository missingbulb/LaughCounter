import { finding } from '../../../engine/checks/helpers/findings.mjs';

// Converted from this pack's no-toolchain prose, on its one mechanical half: a
// script may not probe for a Swift toolchain with `command -v swift` unless
// `xcode-select -p` has already gated it.
//
// `/usr/bin/swift` ships on every Mac as a *stub*. Run it without a developer
// directory and it does not fail — it pops the "install the command line
// developer tools?" panel, an 8 GB download prompted at whoever is trying to
// diagnose a broken app. So the probe is not a weaker test than `xcode-select
// -p`, it is a test of something else entirely: the stub's presence, which is
// universal. `xcode-select -p` fails quietly when no developer directory is
// configured, so it is the gate, and the probe may only run behind it.
//
// Same-or-earlier, not same-line: the gate has to *precede* the probe, and an
// `if xcode-select -p …; then` several lines up is as good as an `&&` on the
// same line. Backslash continuations are joined first, so a probe split across
// physical lines is still read as one command and reported against the line it
// started on.
//
// `#` comments are stripped before matching, in BOTH directions. A script that
// gets this right tends to document the trap directly above the gated call —
// "`command -v swift` is NOT a usable test" — and an unstripped scan flags that
// sentence instead of a violation. A commented-out gate is not a gate either,
// so the same stripping runs before the gate is credited.
//
// Blocking: the failure lands on the user's machine, at the worst moment, and
// nothing in a build or a test suite can see it.

// The probes that ask "is there a swift?". `\bswiftc?\b` deliberately does not
// match `swiftlint`, `swift-format` or any other tool that merely starts that way.
const PROBE = /\b(?:command\s+-v|which|type\s+-p|hash)\s+(?:\/usr\/bin\/)?swiftc?\b/;

// The gate that actually answers the question, in any of its spellings.
const GATE = /\bxcode-select\s+-p\b/;

// A `#` comment: at the start of a line, or after whitespace. Leaves `${#var}`
// and a `#` glued to a word alone, which is as much shell as this needs to know.
const stripComment = (s) => s.replace(/(^|\s)#.*$/, '$1');

const inScope = (f) => /\.(?:sh|bash|zsh)$/.test(f)
  || (f.startsWith('.github/workflows/') && /\.ya?ml$/.test(f));

// Physical lines → logical lines, folding trailing-backslash continuations.
// Each entry keeps the 1-based physical line the command started on.
const logicalLines = (text) => {
  const out = [];
  let buffer = null;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const continued = /\\$/.test(line);
    const body = continued ? line.slice(0, -1) : line;
    if (buffer === null) buffer = { line: i + 1, text: body };
    else buffer.text += ` ${body.trim()}`;
    if (!continued) {
      out.push(buffer);
      buffer = null;
    }
  }
  if (buffer !== null) out.push(buffer);
  return out;
};

const rule = {
  id: 'swift-toolchain-gate',
  severity: 'blocking',
  description: 'A `command -v swift` probe sits behind an `xcode-select -p` gate (shell scripts, workflows)',
  doc: 'packs/macos/RULES.md',
  why: '/usr/bin/swift is a stub present on every Mac that prompts an 8 GB command-line-tools install when run without a developer directory, so `command -v swift` reports success on exactly the toolchain-less Mac the script is meant to degrade on',

  run(ctx) {
    const out = [];
    for (const file of ctx.files.filter(inScope)) {
      const text = ctx.read(file);
      if (text === null) continue;
      let gated = false;
      for (const { line, text: raw } of logicalLines(text)) {
        const command = stripComment(raw);
        if (GATE.test(command)) gated = true;
        if (gated || !PROBE.test(command)) continue;
        out.push(finding(rule, {
          file,
          line,
          what: 'probes for a Swift toolchain with no `xcode-select -p` gate before it',
          fix: 'gate on the developer directory first — `if xcode-select -p >/dev/null 2>&1 && command -v swift >/dev/null 2>&1; then …` — and keep the fallback path working with no toolchain at all',
        }));
      }
    }
    return out;
  },
};

export default rule;
