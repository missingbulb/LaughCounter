// "There is no server either" as a check: the app accepts no inbound
// connection. Scans the app's sources (`mac/Sources/`) for the APIs that open a
// *listening* socket, and for the server frameworks a dashboard would arrive on.
//
// The rule has history. A web dashboard did once exist, in the Python reference,
// and it was removed on purpose along with the reference itself — a listener is
// a decision about who may read the laugh log, and the log is the room's memory.
// That is why reintroducing one is gated on the owner's sign-off, a loopback-only
// default and an auth/CSRF story (the finding's `fix` says so), rather than being
// a feature someone adds on the way past.
//
// Its sibling `no-network-client` covers the outbound half, and earlier sweeps
// read that as covering this half too — a Network-framework `NWListener` needs
// `import Network`, which that check already bans. True, but not the whole
// surface: a listener does not have to come through the Network framework.
// `socket(2)` is reachable from plain `import Foundation` (Darwin is re-exported),
// `NSXPCListener`, `CFSocket*` and `NSSocketPort` are Foundation types, and an
// embedded HTTP server (Vapor, SwiftNIO, Swifter, GCDWebServer) arrives as an
// import, not as `import Network`. None of those trip `no-network-client`. This
// check closes that gap.
//
// Deliberately NOT banned: a bare `listen(`. This is an app whose whole domain
// vocabulary is listening — `requestListening()`, `finishListening()`, `private
// var listening` — and a mic-listening method named `listen()` is a false alarm
// waiting to happen. It costs nothing to drop: BSD sockets are created before
// they are listened on, so `socket(` catches the same code one line earlier, and
// "socket" carries no microphone meaning here. A fixture pins the vocabulary.
//
// Dependency-free by design (a local pack must load without the canon mount),
// so the finding object is built by hand rather than via the engine helper.

const LISTENERS = [
  [/\bNWListener\b/, 'NWListener (a Network-framework listener)'],
  [/\bNSXPCListener\b/, 'NSXPCListener'],
  [/\bCFSocket[A-Za-z]*\s*\(/, 'a CFSocket API'],
  [/\b(?:NS)?SocketPort\b/, 'SocketPort'],
  // The BSD socket primitive. Creating one precedes both listen(2) and
  // connect(2), so this catches a hand-rolled server (and a hand-rolled client).
  [/\bsocket\s*\(/, 'socket(2)'],
  // An embedded HTTP server, which arrives as a package import rather than as
  // anything in the Network framework.
  [
    /^\s*import\s+(?:Vapor|NIO[A-Za-z]*|Swifter|Telegraph|Hummingbird|Kitura[A-Za-z]*|Perfect[A-Za-z]*|FlyingFox|Embassy|GCDWebServer|Criollo)\b/,
    'an embedded HTTP server framework',
  ],
];

const inScope = (f) => f.startsWith('mac/Sources/') && f.endsWith('.swift');

const rule = {
  id: 'on-device-privacy/no-listener',
  severity: 'blocking',
  description: 'No inbound listener — no socket, XPC listener or embedded HTTP server (mac/Sources/)',
  doc: '.claudinite/local/packs/on-device-privacy/RULES.md',
  why: 'a listener exposes the laugh log to whatever can reach the port — reintroducing one is a decision about who may read the room, not a feature',

  run(ctx) {
    const out = [];
    for (const file of ctx.files.filter(inScope)) {
      const text = ctx.read(file);
      if (text === null) continue;
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        for (const [pattern, what] of LISTENERS) {
          if (!pattern.test(lines[i])) continue;
          out.push({
            rule: rule.id,
            severity: rule.severity,
            file,
            line: i + 1,
            what: `${what} in the app (${file})`,
            why: rule.why,
            fix: "drop the listener; a dashboard, metrics port or remote-control API needs the owner's explicit sign-off, a loopback-only default and an auth/CSRF story written into RULES.md before any of it is written in Swift",
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
