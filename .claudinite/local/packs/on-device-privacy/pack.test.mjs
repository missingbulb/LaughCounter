// Red-first fixtures for the on-device-privacy checks: each rule must fire on a
// violating file and stay quiet on the repo's real, clean one. Run directly:
//
//   node --test .claudinite/local/packs/on-device-privacy/pack.test.mjs
//
// They live here rather than in tests/ because a consumer file outside
// .claudinite/ may not reference into it (the claudinite-isolation barrier). The
// fake ctx is the slice of the engine's context a check actually uses — `files`
// and `read` — so these tests need neither the canon mount nor a git checkout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import noNetworkClient from './no-network-client.mjs';
import onDeviceSpeech from './on-device-speech.mjs';
import noAudioPersistence from './no-audio-persistence.mjs';

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

test('no-network-client fires on a client in the capture path', () => {
  const findings = noNetworkClient.run(ctxOf({
    'mac/Sources/LaughCounter/Sync.swift': 'let task = URLSession.shared.dataTask(with: url)\n',
    'mac/Sources/LaughCounter/Peer.swift': 'import Foundation\nimport Network\n',
  }));
  assert.equal(findings.length, 2);
  assert.deepEqual(findings.map((f) => f.line), [1, 2]);
  assert.match(findings[0].what, /URLSession/);
  assert.match(findings[1].what, /Network framework/);
});

test('no-network-client stays quiet on the real capture path', () => {
  const findings = noNetworkClient.run(realCtx(
    'mac/Sources/LaughCounter/AudioHub.swift',
    'mac/Sources/LaughCounter/VoiceCommand.swift',
    'mac/Sources/LaughCounter/Store.swift',
    'mac/Sources/LaughCounter/LaughDetector.swift',
  ));
  assert.deepEqual(findings, []);
});

test('on-device-speech fires on a request that never opts out', () => {
  const findings = onDeviceSpeech.run(ctxOf({
    'mac/Sources/LaughCounter/VoiceCommand.swift':
      'let newRequest = SFSpeechAudioBufferRecognitionRequest()\n'
      + 'newRequest.shouldReportPartialResults = true\n',
  }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 1);
});

test('on-device-speech stays quiet on the real VoiceCommand', () => {
  const findings = onDeviceSpeech.run(realCtx('mac/Sources/LaughCounter/VoiceCommand.swift'));
  assert.deepEqual(findings, []);
});

test('no-audio-persistence fires on an audio-writing API in the capture path', () => {
  const findings = noAudioPersistence.run(ctxOf({
    'mac/Sources/LaughCounter/ClipWriter.swift':
      'let file = try AVAudioFile(forWriting: url, settings: format.settings)\n'
      + 'let recorder = try AVAudioRecorder(url: url, settings: settings)\n',
  }));
  assert.equal(findings.length, 2);
  assert.deepEqual(findings.map((f) => f.line), [1, 2]);
  assert.match(findings[0].what, /AVAudioFile/);
  assert.match(findings[1].what, /AVAudioRecorder/);
});

test('no-audio-persistence stays quiet on a read-only AVAudioFile load (a bundled sound asset)', () => {
  const findings = noAudioPersistence.run(ctxOf({
    'mac/Sources/LaughCounter/CustomChime.swift':
      'let file = try AVAudioFile(forReading: bundledSoundURL)\n',
  }));
  assert.deepEqual(findings, []);
});

test('no-audio-persistence stays quiet on the real capture path', () => {
  const findings = noAudioPersistence.run(realCtx(
    'mac/Sources/LaughCounter/AudioHub.swift',
    'mac/Sources/LaughCounter/VoiceCommand.swift',
    'mac/Sources/LaughCounter/Store.swift',
    'mac/Sources/LaughCounter/LaughDetector.swift',
    'mac/Sources/LaughCounter/AppLog.swift',
  ));
  assert.deepEqual(findings, []);
});
