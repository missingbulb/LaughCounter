// "Never open the device to ask a question about it" (#88), as a check on the
// *touch* rather than the construction: `engine.inputNode` may only be reached
// in `AudioHub`.
//
// Reading `inputNode` is not a property read. It creates the input node lazily,
// which opens the default input device and mints a hidden per-client aggregate
// device inside coreaudiod (`CADefaultDeviceAggregate-<pid>-<n>`); one measured
// outage ran that open/create/destroy cycle ~210 times over 3h40m against
// hardware that was not there. Cycling the device is the one mechanism by which
// this app could plausibly wedge a mic, so the cost of an answer is a property of
// the API you ask, not of how often you ask it. Availability questions go to
// `AudioDiagnostics`, which answers from `AudioObjectGetPropertyData` property
// queries that open nothing.
//
// Its sibling `engine-construction-confined` is NOT this check. That one bans
// `AVAudioEngine(` outside `AudioHub`, and a file that never constructs an engine
// can still be handed one:
//
//     func probeRate(engine: AVAudioEngine) -> Double {
//         engine.inputNode.inputFormat(forBus: 0).sampleRate
//     }
//
// opens the device and trips nothing (a fixture pins that gap — the repo's own
// rule is that "already covered by another check" is a claim you hand a violating
// file, not one you reason out).
//
// Comments are stripped before matching, because the sources discuss
// `engine.inputNode` at length in exactly the files that must not touch it —
// `AppDelegate` and `AudioDiagnostics` both explain the aggregate-device cost in
// a doc comment. Stripping is deliberately conservative: `//` that follows a
// colon is left alone so a `https://` URL is not mistaken for a comment.
//
// Dependency-free by design (a local pack must load without the canon mount),
// so the finding object is built by hand rather than via the engine helper.

// The one file allowed to touch it. `AudioHub` owns the microphone: it
// materializes `inputNode` before `prepare()` (#72), installs and removes the
// tap, and reads the input format for `validatedFormat()`.
const OWNER = 'mac/Sources/LaughCounter/AudioHub.swift';

// A member access, not a mention: `engine.inputNode`, `self.engine.inputNode`.
const TOUCH = /\.inputNode\b/;

// Block comments first, then line comments — `//` only when it is not the tail of
// a `scheme://` URL. Newlines are preserved so reported line numbers stay true.
const stripComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .split('\n')
  .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
  .join('\n');

const inScope = (f) => f.startsWith('mac/Sources/') && f.endsWith('.swift');

const rule = {
  id: 'macos-audio/input-node-confined',
  severity: 'blocking',
  description: 'Only AudioHub touches engine.inputNode — reading it opens the default input device (mac/Sources/)',
  doc: '.claudinite/local/packs/macos-audio/RULES.md',
  why: 'accessing inputNode materializes the input node, which opens the default input and churns a hidden coreaudiod aggregate device — the one mechanism by which this app could plausibly wedge a mic',

  run(ctx) {
    const out = [];
    for (const file of ctx.files.filter(inScope)) {
      if (file === OWNER) continue;
      const text = ctx.read(file);
      if (text === null) continue;
      const lines = stripComments(text).split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        if (!TOUCH.test(lines[i])) continue;
        out.push({
          rule: rule.id,
          severity: rule.severity,
          file,
          line: i + 1,
          what: `reaches engine.inputNode outside ${OWNER} (${file})`,
          why: rule.why,
          fix: 'ask AudioDiagnostics instead — `hasUsableInput` / `inputAvailability` answer from HAL property queries that open no device; if the format or a tap really is needed, route it through AudioHub, the single owner of the engine lifecycle',
          doc: rule.doc,
        });
      }
    }
    return out;
  },
};

export default rule;
