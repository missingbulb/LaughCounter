// "The counter reads no clock and touches no device", as a check.
//
// `LaughCounter.swift` is the decision layer: it turns a stream of
// `LaughObservation`s into discrete, counted, attributed episodes. Every time it
// uses is the *audio* time carried on the observation, derived from
// `SNClassificationResult.timeRange` (#5 — real durations, not a fixed 0.5s per
// window), so an episode's start/end/duration stay true across a restart and a
// sleep. The moment this file reads the wall clock instead, an episode's duration
// silently becomes "how long the analysis took to arrive" rather than how long the
// laugh was — and the counting rules stop being exercisable without a microphone.
//
// The file's own contract says it: "Deterministic and I/O-free." This check keeps
// that contract honest as a positive whitelist over the counting core's imports,
// plus a ban on the clock and capture symbols that would break it.
//
// Dependency-free by design (a local pack must load without the canon mount), so
// the finding objects are built by hand rather than via the engine helper.

// The counting core — the file that owns the classifier-stream → episode decision.
const CORE = 'mac/Sources/LaughCounter/LaughCounter.swift';

// The only import a pure decision layer needs. AVFoundation / SoundAnalysis /
// AppKit / Speech here would mean the counter has started to reach at the capture
// path or the UI instead of being handed observations.
const ALLOWED_IMPORTS = new Set(['Foundation']);

const IMPORT = /^\s*import\s+([A-Za-z_][A-Za-z0-9_.]*)/gm;

// Reading "now" from anywhere. `Date(timeIntervalSince1970:)` — constructing a
// date *from* an observation's epoch — is not a clock read, so the patterns match
// the now-returning forms only.
const CLOCK = [
  { re: /\bDate\s*\(\s*\)/g, what: 'reads the wall clock with Date()' },
  { re: /\bCACurrentMediaTime\s*\(/g, what: 'reads the host clock with CACurrentMediaTime()' },
  { re: /\bmach_absolute_time\s*\(/g, what: 'reads the host clock with mach_absolute_time()' },
  { re: /\bDispatchTime\.now\s*\(/g, what: 'reads the clock with DispatchTime.now()' },
  { re: /\bsystemUptime\b/g, what: 'reads the clock with ProcessInfo.systemUptime' },
];

const rule = {
  id: 'laugh-detection/counting-core-clock-free',
  severity: 'blocking',
  description: 'The counting core takes its time from the observation — no clock reads, no capture imports (LaughCounter.swift)',
  doc: '.claudinite/local/packs/laugh-detection/RULES.md',
  why: 'an episode timed by the wall clock measures how long analysis took to arrive, not how long the laugh was — and a counter that reads the clock cannot be exercised without a microphone',

  run(ctx) {
    if (!ctx.files.includes(CORE)) return [];
    const text = ctx.read(CORE);
    if (text === null) return [];
    const lineOf = (index) => text.slice(0, index).split('\n').length;
    const out = [];

    IMPORT.lastIndex = 0;
    let m = IMPORT.exec(text);
    while (m !== null) {
      if (!ALLOWED_IMPORTS.has(m[1])) {
        out.push({
          rule: rule.id,
          severity: rule.severity,
          file: CORE,
          line: lineOf(m.index),
          what: `the counting core imports ${m[1]}`,
          why: rule.why,
          fix: `keep ${CORE} a pure decision layer over LaughObservation — take what it needs as fields on the observation (LaughDetector already carries the window's real timing, laugh class and context scores) instead of importing ${m[1]}`,
          doc: rule.doc,
        });
      }
      m = IMPORT.exec(text);
    }

    for (const { re, what } of CLOCK) {
      re.lastIndex = 0;
      let hit = re.exec(text);
      while (hit !== null) {
        out.push({
          rule: rule.id,
          severity: rule.severity,
          file: CORE,
          line: lineOf(hit.index),
          what: `the counting core ${what}`,
          why: rule.why,
          fix: 'use the time on the observation (`obs.time` / `obs.windowDuration`, which come from SNClassificationResult.timeRange) — the counter is handed audio time, it never asks what time it is',
          doc: rule.doc,
        });
        hit = re.exec(text);
      }
    }

    return out;
  },
};

export default rule;
