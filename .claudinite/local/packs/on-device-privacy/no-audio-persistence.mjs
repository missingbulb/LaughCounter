// The privacy boundary's other half: metadata persists, audio doesn't. Scans
// the app's sources (`mac/Sources/`) for the APIs that write audio data to
// disk. It matches API tokens, not file extensions, so a comment or a string
// literal mentioning "audio file" stays legal while an actual writer does not.
//
// This is the v1 state (docs/DESIGN-AND-TRADEOFFS.md §6: "in v1, not stored at
// all"). The roadmap's v3 deliberately adds a rolling audio buffer for
// retraining — landing that is a product decision, not an incidental line of
// Swift, so it updates this pack (and the mic prompt) in the same PR that
// removes or narrows this check, exactly as no-network-client expects of a
// deliberate future egress decision.
//
// Dependency-free by design (a local pack must load without the canon mount),
// so the finding object is built by hand rather than via the engine helper.

const AUDIO_WRITERS = [
  // `forWriting:` only — `AVAudioFile(forReading:)` is a legitimate way to load
  // a bundled sound asset and isn't persistence, so it's deliberately not banned.
  [/\bAVAudioFile\s*\(\s*forWriting\b/, 'AVAudioFile(forWriting:)'],
  [/\bAVAudioRecorder\s*\(/, 'AVAudioRecorder'],
  [/\bExtAudioFileCreateWithURL\s*\(/, 'ExtAudioFileCreateWithURL'],
  [/\bAudioFileCreateWithURL\s*\(/, 'AudioFileCreateWithURL'],
];

const inScope = (f) => f.startsWith('mac/Sources/') && f.endsWith('.swift');

const rule = {
  id: 'on-device-privacy/no-audio-persistence',
  severity: 'blocking',
  description: 'No on-disk audio-writing API in the always-on capture path (mac/Sources/)',
  doc: '.claudinite/local/packs/on-device-privacy/RULES.md',
  why: 'the product promise is that only derived metadata is kept and no audio is stored — a file-writing audio API in the capture path is how that promise breaks',

  run(ctx) {
    const out = [];
    for (const file of ctx.files.filter(inScope)) {
      const text = ctx.read(file);
      if (text === null) continue;
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        for (const [pattern, what] of AUDIO_WRITERS) {
          if (!pattern.test(lines[i])) continue;
          out.push({
            rule: rule.id,
            severity: rule.severity,
            file,
            line: i + 1,
            what: `${what} in the capture path (${file})`,
            why: rule.why,
            fix: 'keep audio out of persistence — drop the writer; deliberately adding audio storage (the v3 roadmap) is a product decision that belongs in RULES.md and the mic usage strings first',
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
