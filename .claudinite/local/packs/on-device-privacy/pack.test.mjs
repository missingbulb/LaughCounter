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
import loopbackDefault from './loopback-default.mjs';
import onDeviceSpeech from './on-device-speech.mjs';
import singleHomeDirectory from './single-home-directory.mjs';
import jsonContentTypeGuard from './json-content-type-guard.mjs';

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
    'laughcounter/uploader.py': 'import json\nimport requests\n',
    'mac/Sources/LaughCounter/Sync.swift': 'let task = URLSession.shared.dataTask(with: url)\n',
  }));
  assert.equal(findings.length, 2);
  assert.deepEqual(findings.map((f) => f.line), [2, 1]);
  assert.match(findings[0].what, /requests/);
  assert.match(findings[1].what, /URLSession/);
});

test('no-network-client stays quiet on the real capture path', () => {
  const findings = noNetworkClient.run(realCtx(
    'laughcounter/dashboard.py',        // http.server, loopback — a server, not a client
    'laughcounter/detector/yamnet.py',  // a TF-Hub URL string, fetched by the library
    'laughcounter/notify.py',
    'mac/Sources/LaughCounter/AudioHub.swift',
    'mac/Sources/LaughCounter/VoiceCommand.swift',
  ));
  assert.deepEqual(findings, []);
});

test('loopback-default fires on a non-loopback host default', () => {
  const findings = loopbackDefault.run(ctxOf({
    'laughcounter/config.py': '    dashboard_host: str = "0.0.0.0"\n',
    'laughcounter/dashboard.py': 'def serve(db, host: str = "192.168.1.10"):\n    pass\n',
  }));
  assert.equal(findings.length, 2);
  assert.match(findings[0].what, /dashboard_host defaults to "0\.0\.0\.0"/);
});

test('loopback-default stays quiet on the real defaults', () => {
  const findings = loopbackDefault.run(realCtx(
    'laughcounter/config.py',
    'laughcounter/dashboard.py',
    'laughcounter/cli.py',
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

test('single-home-directory fires on state scattered outside the one directory', () => {
  const findings = singleHomeDirectory.run(ctxOf({
    'laughcounter/cache.py': 'MODELS = os.path.expanduser("~/.cache/laughcounter/models")\n',
    'laughcounter/logs.py': 'LOG = Path.home() / "Documents" / "laughs.log"\n',
    'mac/Sources/LaughCounter/Cache.swift':
      'let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]\n',
    'mac/Sources/LaughCounter/Loose.swift':
      'let base = FileManager.default.urls(for: .applicationSupportDirectory,\n'
      + '                                    in: .userDomainMask)[0]\n'
      + 'let file = base.appendingPathComponent("laughs.jsonl")\n',
    'mac/Sources/LaughCounter/Home.swift':
      'let dir = NSHomeDirectory() + "/laughcounter"\n',
  }));
  assert.equal(findings.length, 5);
  assert.match(findings[0].what, /~\/\.cache/);
  assert.match(findings[1].what, /~\/Documents/);
  assert.match(findings[2].what, /\.cachesDirectory/);
  assert.match(findings[3].what, /without being narrowed/);
  assert.match(findings[4].what, /NSHomeDirectory/);
});

test('single-home-directory stays quiet on the real state locations', () => {
  const findings = singleHomeDirectory.run(realCtx(
    'laughcounter/config.py',       // Path.home() / ".laughcounter"
    'laughcounter/speaker.py',      // expanduser("~/.laughcounter/models/ecapa")
    'laughcounter/clips.py',
    'laughcounter/storage.py',
    'laughcounter/cli.py',          // prints ~/Library/LaunchAgents — launchd's own location
    'mac/Sources/LaughCounter/Store.swift',
    'mac/Sources/LaughCounter/AppLog.swift',
  ));
  assert.deepEqual(findings, []);
});

test('json-content-type-guard fires on a mutating handler with no guard', () => {
  const findings = jsonContentTypeGuard.run(ctxOf({
    'laughcounter/dashboard.py':
      '        def do_POST(self):\n'
      + '            data = self._read_json()\n'
      + '            self._send(200, "application/json", b"{}")\n',
  }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 1);
  assert.match(findings[0].what, /do_POST never requires an application\/json/);
});

test('json-content-type-guard fires when the body is read before the guard', () => {
  const findings = jsonContentTypeGuard.run(ctxOf({
    'laughcounter/dashboard.py':
      '        def do_PUT(self):\n'
      + '            data = self._read_json()\n'
      + '            ctype = self.headers.get("Content-Type", "")\n'
      + '            if "application/json" not in ctype:\n'
      + '                return\n',
  }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 2);
  assert.match(findings[0].what, /reads the request body before/);
});

test('json-content-type-guard stays quiet on the real dashboard', () => {
  const findings = jsonContentTypeGuard.run(realCtx(
    'laughcounter/dashboard.py',
    'laughcounter/cli.py',
  ));
  assert.deepEqual(findings, []);
});
