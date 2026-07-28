// The privacy boundary as a check: the always-on capture path may not open an
// outbound connection. Scans the app's sources (`mac/Sources/`) for network
// *client* APIs. It matches call/import tokens rather than URL strings, so a
// comment mentioning a URL stays legal while an actual client does not.
//
// Since the Python reference was removed there is exactly one runtime tree and
// **no accepted egress at all** — detection (Sound Analysis) and speech
// recognition are both on-device, and nothing downloads a model. That makes this
// check absolute: any hit is a finding, with no optional-extra carve-out to
// reason about.
//
// Dependency-free by design (a local pack must load without the canon mount),
// so the finding object is built by hand rather than via the engine helper.

const SWIFT_CLIENTS = [
  [/\bURLSession\b/, 'URLSession'],
  [/\bNSURLConnection\b/, 'NSURLConnection'],
  [/^\s*import\s+Network\b/, 'the Network framework'],
  [/\bNWConnection\b/, 'NWConnection'],
];

const inScope = (f) => f.startsWith('mac/Sources/') && f.endsWith('.swift');

const rule = {
  id: 'on-device-privacy/no-network-client',
  severity: 'blocking',
  description: 'No outbound network client in the always-on capture path (mac/Sources/)',
  doc: '.claudinite/local/packs/on-device-privacy/RULES.md',
  why: "the product's headline promise is that the room's audio never leaves the machine — a client in the capture path is how that promise breaks",

  run(ctx) {
    const out = [];
    for (const file of ctx.files.filter(inScope)) {
      const text = ctx.read(file);
      if (text === null) continue;
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        for (const [pattern, what] of SWIFT_CLIENTS) {
          if (!pattern.test(lines[i])) continue;
          out.push({
            rule: rule.id,
            severity: rule.severity,
            file,
            line: i + 1,
            what: `${what} in the capture path (${file})`,
            why: rule.why,
            fix: 'keep analysis on-device — drop the client; the app has no accepted egress, so adding one is a product decision that belongs in RULES.md first',
            doc: rule.doc,
          });
          break;
        }
      }
    }
    return out;
  },
};

export default rule;
