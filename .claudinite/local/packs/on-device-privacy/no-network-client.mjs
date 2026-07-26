// The privacy boundary as a check: the always-on capture path may not open an
// outbound connection. Scans the two runtime trees that touch the microphone —
// laughcounter/ (the Python reference) and mac/Sources/ (the native app) — for
// network *client* APIs. It matches call/import tokens, not URL strings, so the
// optional extras' documented one-time model download (the tfhub handle in
// detector/yamnet.py, SpeechBrain's in speaker.py) stays legal: that fetch is
// made by the ML library inside an optional extra and carries no audio.
// Dependency-free by design (a local pack must load without the canon mount),
// so the finding object is built by hand rather than via the engine helper.

const PY_CLIENTS = [
  [/^\s*import\s+requests\b/, 'requests'],
  [/^\s*import\s+httpx\b/, 'httpx'],
  [/^\s*(?:import\s+urllib\.request|from\s+urllib(?:\.request)?\s+import)\b/, 'urllib.request'],
  [/^\s*(?:import\s+http\.client|from\s+http\.client\s+import)\b/, 'http.client'],
  [/^\s*(?:import\s+socket|from\s+socket\s+import)\b/, 'socket'],
  [/^\s*(?:import\s+(?:ftplib|smtplib)|from\s+(?:ftplib|smtplib)\s+import)\b/, 'an internet protocol client'],
  [/\burlopen\s*\(/, 'urlopen()'],
];

const SWIFT_CLIENTS = [
  [/\bURLSession\b/, 'URLSession'],
  [/\bNSURLConnection\b/, 'NSURLConnection'],
  [/^\s*import\s+Network\b/, 'the Network framework'],
  [/\bNWConnection\b/, 'NWConnection'],
];

const inScope = (f) =>
  (f.startsWith('laughcounter/') && f.endsWith('.py')) ||
  (f.startsWith('mac/Sources/') && f.endsWith('.swift'));

const rule = {
  id: 'on-device-privacy/no-network-client',
  severity: 'blocking',
  description: 'No outbound network client in the always-on capture path (laughcounter/, mac/Sources/)',
  doc: '.claudinite/local/packs/on-device-privacy/RULES.md',
  why: "the product's headline promise is that the room's audio never leaves the machine — a client in the capture path is how that promise breaks",

  run(ctx) {
    const out = [];
    for (const file of ctx.files.filter(inScope)) {
      const text = ctx.read(file);
      if (text === null) continue;
      const patterns = file.endsWith('.py') ? PY_CLIENTS : SWIFT_CLIENTS;
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        for (const [pattern, what] of patterns) {
          if (!pattern.test(lines[i])) continue;
          out.push({
            rule: rule.id,
            severity: rule.severity,
            file,
            line: i + 1,
            what: `${what} in the capture path (${file})`,
            why: rule.why,
            fix: 'keep analysis on-device — drop the client, or move the network call into an optional extra that never handles audio (and say so in RULES.md)',
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
