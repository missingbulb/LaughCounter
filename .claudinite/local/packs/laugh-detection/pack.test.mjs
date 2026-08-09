// Red-first fixtures for the laugh-detection checks: each rule must fire on a
// violating file and stay quiet on the repo's real, clean ones. Run directly:
//
//   node --test .claudinite/local/packs/laugh-detection/pack.test.mjs
//
// They live here rather than in tests/ (`claudinite-isolation`). The fake ctx is
// the slice of the engine's context a check actually uses — `files` and `read` —
// so these tests need neither the canon mount nor a git checkout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import countingCoreClockFree from './counting-core-clock-free.mjs';
import classifierKeywordsLowercase from './classifier-keywords-lowercase.mjs';
import hysteresisContract from './hysteresis-contract.mjs';

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

const CORE = 'mac/Sources/LaughCounter/LaughCounter.swift';
const DETECTOR = 'mac/Sources/LaughCounter/LaughDetector.swift';

const REAL_SWIFT = [
  'mac/Sources/LaughCounter/AppDelegate.swift',
  'mac/Sources/LaughCounter/AppLog.swift',
  'mac/Sources/LaughCounter/AudioDiagnostics.swift',
  'mac/Sources/LaughCounter/AudioHub.swift',
  'mac/Sources/LaughCounter/Chime.swift',
  CORE,
  DETECTOR,
  'mac/Sources/LaughCounter/Store.swift',
  'mac/Sources/LaughCounter/VoiceCommand.swift',
  'mac/Sources/LaughCounter/main.swift',
];

// A minimal stand-in for the counting core: the shape the checks parse.
const core = ({ imports = 'import Foundation\n', body = '', settings } = {}) => imports
  + 'final class LaughCounter {\n'
  + `    var countThreshold = ${settings?.count ?? 0.5}\n`
  + `    var enterThreshold = ${settings?.enter ?? 0.15}\n`
  + `    var exitThreshold = ${settings?.exit ?? 0.1}\n`
  + `    var mergeGap = ${settings?.gap ?? 2.0}\n`
  + '    func update(_ obs: LaughObservation) {\n'
  + `${body}`
  + '    }\n'
  + '}\n';

// --- counting-core-clock-free -------------------------------------------------

test('counting-core-clock-free fires when the counter reads the wall clock', () => {
  const findings = countingCoreClockFree.run(ctxOf({
    [CORE]: core({ body: '        let now = Date().timeIntervalSince1970\n' }),
  }));
  assert.equal(findings.length, 1);
  assert.match(findings[0].what, /reads the wall clock with Date\(\)/);
  assert.equal(findings[0].file, CORE);
});

test('counting-core-clock-free fires when the counter imports the capture stack', () => {
  const findings = countingCoreClockFree.run(ctxOf({
    [CORE]: core({ imports: 'import Foundation\nimport AVFoundation\nimport SoundAnalysis\n' }),
  }));
  assert.equal(findings.length, 2);
  assert.deepEqual(findings.map((f) => f.what).sort(), [
    'the counting core imports AVFoundation',
    'the counting core imports SoundAnalysis',
  ]);
});

test('counting-core-clock-free allows a Date built from an observation epoch', () => {
  const findings = countingCoreClockFree.run(ctxOf({
    [CORE]: core({ body: '        let at = Date(timeIntervalSince1970: obs.time)\n' }),
  }));
  assert.deepEqual(findings, []);
});

test('counting-core-clock-free is quiet on the real counting core', () => {
  assert.deepEqual(countingCoreClockFree.run(realCtx(...REAL_SWIFT)), []);
});

// --- classifier-keywords-lowercase --------------------------------------------

test('classifier-keywords-lowercase fires on a capitalised keyword', () => {
  const findings = classifierKeywordsLowercase.run(ctxOf({
    [DETECTOR]: 'final class LaughDetector {\n'
      + '    private static let laughKeywords = ["laugh", "Giggl", "chuckl"]\n'
      + '}\n',
  }));
  assert.equal(findings.length, 1);
  assert.match(findings[0].what, /laughKeywords contains "Giggl"/);
  assert.match(findings[0].fix, /"giggl"/);
  assert.equal(findings[0].line, 2);
});

test('classifier-keywords-lowercase covers a newly added keyword list', () => {
  const findings = classifierKeywordsLowercase.run(ctxOf({
    [DETECTOR]: '    private static let tvKeywords = ["applause", "Crowd"]\n'
      + '    private static let doorKeywords = ["knock", "Doorbell"]\n',
  }));
  assert.deepEqual(findings.map((f) => f.what), [
    'tvKeywords contains "Crowd", which is not lowercase',
    'doorKeywords contains "Doorbell", which is not lowercase',
  ]);
});

test('classifier-keywords-lowercase is quiet on the real sources', () => {
  assert.deepEqual(classifierKeywordsLowercase.run(realCtx(...REAL_SWIFT)), []);
});

// --- hysteresis-contract ------------------------------------------------------

test('hysteresis-contract fires when the exit bar is not below the enter bar', () => {
  const findings = hysteresisContract.run(ctxOf({
    [CORE]: core({ settings: { count: 0.5, enter: 0.15, exit: 0.15, gap: 2.0 } }),
  }));
  assert.equal(findings.length, 1);
  assert.match(findings[0].what, /no hysteresis band/);
});

test('hysteresis-contract fires when the candidate band is inverted', () => {
  const findings = hysteresisContract.run(ctxOf({
    [CORE]: core({ settings: { count: 0.3, enter: 0.4, exit: 0.1, gap: 2.0 } }),
  }));
  assert.equal(findings.length, 1);
  assert.match(findings[0].what, /candidate band is inverted/);
});

test('hysteresis-contract fires when mergeGap sits at the classifier window hop', () => {
  const findings = hysteresisContract.run(ctxOf({
    [CORE]: core({ settings: { count: 0.5, enter: 0.15, exit: 0.1, gap: 1.5 } }),
  }));
  assert.equal(findings.length, 1);
  assert.match(findings[0].what, /does not exceed the classifier's ~1\.5s window hop/);
});

test('hysteresis-contract is quiet on the real counting core', () => {
  assert.deepEqual(hysteresisContract.run(realCtx(...REAL_SWIFT)), []);
});
