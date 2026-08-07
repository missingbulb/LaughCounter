// Red-first fixtures for the macos-audio checks: each rule must fire on
// a violating file and stay quiet on the repo's real, clean ones. Run directly:
//
//   node --test .claudinite/local/packs/macos-audio/pack.test.mjs
//
// They live here rather than in tests/ (`claudinite-isolation`). The fake ctx is
// the slice of the engine's context a check actually uses — `files` and `read` —
// so these tests need neither the canon mount nor a git checkout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import engineConstructionConfined from './engine-construction-confined.mjs';
import signalTeardownRouting from './signal-teardown-routing.mjs';
import noSuddenTermination from './no-sudden-termination.mjs';

const repoRoot = dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))));

// Fixture ctx: an in-memory tree of { path: contents }.
const ctxOf = (tree) => ({
  files: Object.keys(tree),
  read: (path) => tree[path] ?? null,
});

// The real tree, so a rule that starts firing on the actual sources fails here.
const realCtx = (...paths) => ctxOf(Object.fromEntries(
  paths.map((p) => [p, readFileSync(join(repoRoot, p), 'utf8')])
));

const REAL_SWIFT = [
  'mac/Sources/LaughCounter/AppDelegate.swift',
  'mac/Sources/LaughCounter/AppLog.swift',
  'mac/Sources/LaughCounter/AudioDiagnostics.swift',
  'mac/Sources/LaughCounter/AudioHub.swift',
  'mac/Sources/LaughCounter/Chime.swift',
  'mac/Sources/LaughCounter/LaughCounter.swift',
  'mac/Sources/LaughCounter/LaughDetector.swift',
  'mac/Sources/LaughCounter/Store.swift',
  'mac/Sources/LaughCounter/VoiceCommand.swift',
  'mac/Sources/LaughCounter/main.swift',
];

test('engine-construction-confined fires on an engine built outside AudioHub', () => {
  const findings = engineConstructionConfined.run(ctxOf({
    'mac/Sources/LaughCounter/MicProbe.swift':
      'import AVFoundation\n'
      + 'func micExists() -> Bool {\n'
      + '    let probe = AVAudioEngine()\n'
      + '    return probe.inputNode.inputFormat(forBus: 0).sampleRate > 0\n'
      + '}\n',
  }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 3);
  assert.match(findings[0].what, /outside mac\/Sources\/LaughCounter\/AudioHub\.swift/);
});

test('engine-construction-confined ignores mentions that are not constructions', () => {
  const findings = engineConstructionConfined.run(ctxOf({
    'mac/Sources/LaughCounter/AppDelegate.swift':
      'private var engine: AVAudioEngine?\n'
      + '// (Re)starting the engine posts .AVAudioEngineConfigurationChange.\n'
      + 'NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: nil, queue: .main) { _ in }\n',
  }));
  assert.deepEqual(findings, []);
});

test('engine-construction-confined stays quiet on the real sources', () => {
  assert.deepEqual(engineConstructionConfined.run(realCtx(...REAL_SWIFT)), []);
});

test('signal-teardown-routing fires when a tap is installed and nothing routes signals', () => {
  const findings = signalTeardownRouting.run(ctxOf({
    'mac/Sources/LaughCounter/AudioHub.swift':
      'input.installTap(onBus: 0, bufferSize: 8192, format: format) { _, _ in }\n',
    'mac/Sources/LaughCounter/main.swift': 'let app = NSApplication.shared\napp.run()\n',
  }));
  assert.equal(findings.length, 1);
  assert.match(findings[0].what, /nothing routes termination signals/);
});

test('signal-teardown-routing fires on SIG_IGN after resume(), and on a missing signal', () => {
  const findings = signalTeardownRouting.run(ctxOf({
    'mac/Sources/LaughCounter/AudioHub.swift':
      'input.installTap(onBus: 0, bufferSize: 8192, format: format) { _, _ in }\n',
    'mac/Sources/LaughCounter/main.swift':
      'let sources: [DispatchSourceSignal] = [SIGTERM, SIGINT].map { sig in\n'
      + '    let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)\n'
      + '    source.setEventHandler { NSApp.terminate(nil) }\n'
      + '    source.resume()\n'
      + '    signal(sig, SIG_IGN)\n'
      + '    return source\n'
      + '}\n',
  }));
  assert.equal(findings.length, 2);
  assert.match(findings[0].what, /does not cover SIGHUP/);
  assert.match(findings[1].what, /only after resume\(\)/);
  assert.equal(findings[1].line, 4);
});

test('signal-teardown-routing says nothing about a tree that installs no tap', () => {
  assert.deepEqual(signalTeardownRouting.run(ctxOf({
    'mac/Sources/LaughCounter/main.swift': 'let app = NSApplication.shared\napp.run()\n',
  })), []);
});

test('signal-teardown-routing stays quiet on the real sources', () => {
  assert.deepEqual(signalTeardownRouting.run(realCtx(...REAL_SWIFT)), []);
});

test('no-sudden-termination fires on a plist that opts in', () => {
  const findings = noSuddenTermination.run(ctxOf({
    'mac/Resources/Info.plist':
      '<dict>\n'
      + '    <key>LSUIElement</key>\n'
      + '    <true/>\n'
      + '    <key>NSSupportsSuddenTermination</key>\n'
      + '    <true/>\n'
      + '</dict>\n',
  }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 4);
});

test('no-sudden-termination stays quiet on the real Info.plist', () => {
  assert.deepEqual(noSuddenTermination.run(realCtx('mac/Resources/Info.plist')), []);
});
