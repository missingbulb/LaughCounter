// "Assume no toolchain on the machine that runs it", as a check on the one
// mechanical half of it: a script may not probe for a Swift toolchain with
// `command -v swift` unless `xcode-select -p` has already gated it.
//
// The owner's Mac installs the DMG from CI and has no Xcode command line tools.
// `command -v swift` reports success there anyway, because `/usr/bin/swift` ships
// on every Mac as a *stub*: run it without a developer directory and it does not
// fail, it pops the "install the command line tools?" panel — an 8 GB download
// prompted at the person diagnosing a dead microphone. The probe is therefore not
// a weaker test than `xcode-select -p`, it is a test of something else entirely
// (the stub's presence, which is universal). `xcode-select -p` fails cleanly when
// no developer directory is configured, so it is the gate; `command -v swift` may
// only run behind it, as `mac/scripts/diagnose-mic.sh` does.
//
// Same-or-earlier, not same-line: the gate has to *precede* the probe, and an
// `if xcode-select -p …; then` several lines up is as good as an `&&` on the same
// line. Backslash continuations are joined first so a probe split across physical
// lines is still read as one command, and reported against its first line.
//
// `#` comments are stripped before matching, in both directions. The script this
// rule was learned on *documents* the trap directly above the gated call — "`command
// -v swift` is NOT a usable test" — and the first draft of this check flagged that
// sentence (the real-tree fixture is what caught it). A commented-out gate is not a
// gate either, so the same stripping runs before the gate is credited.
//
// Dependency-free by design (a local pack must load without the canon mount),
// so the finding object is built by hand rather than via the engine helper.

// The probes that ask "is there a swift?" — `\bswift\b` deliberately does not
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
  id: 'macos-audio/swift-toolchain-gate',
  severity: 'blocking',
  description: 'A `command -v swift` probe must sit behind an `xcode-select -p` gate (shell scripts, workflows)',
  doc: '.claudinite/local/packs/macos-audio/RULES.md',
  why: '/usr/bin/swift is a stub that exists on every Mac and prompts an 8 GB command-line-tools install when run without a developer directory, so `command -v swift` passes on the toolchain-less Mac this app is diagnosed on',

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
        out.push({
          rule: rule.id,
          severity: rule.severity,
          file,
          line,
          what: `probes for a Swift toolchain with no \`xcode-select -p\` gate before it (${file}:${line})`,
          why: rule.why,
          fix: 'gate on the developer directory first — `if xcode-select -p >/dev/null 2>&1 && command -v swift >/dev/null 2>&1; then …` — and keep the fallback path working without a toolchain at all, since the Mac that runs this installs the DMG from CI',
          doc: rule.doc,
        });
      }
    }
    return out;
  },
};

export default rule;
