// Red-first fixtures for the laughcounter checks: each rule must fire on a
// violating file and stay quiet on the repo's real, clean sources. Run directly:
//
//   node --test .claudinite/local/packs/laughcounter/pack.test.mjs
//
// This is a DECLARATION (declared-checks.json), so it compiles through the
// mounted engine and needs `.claudinite/shared/` present.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadDeclaredChecks } from '../../../shared/engine/checks/helpers/pattern-rules.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(dirname(dirname(dirname(here))));

const declared = (id) => {
  const rule = loadDeclaredChecks(here).find((r) => r.id === id);
  if (!rule) throw new Error(`no declared check ${id} in ${here}/declared-checks.json`);
  return rule;
};
const singleVersionSource = declared('laughcounter/single-version-source');

// Fixture ctx: an in-memory tree of { path: contents }.
const ctxOf = (tree) => ({
  files: Object.keys(tree),
  tracked: Object.keys(tree),
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

test('single-version-source fires on a hand-written version+build literal outside AppDelegate', () => {
  const findings = singleVersionSource.run(ctxOf({
    'mac/Sources/LaughCounter/AboutPanel.swift':
      'import AppKit\n'
      + 'let subtitle = "v0.3.1 (5)"\n',
  }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 2);
  assert.match(findings[0].what, /outside AppDelegate\.swift/);
});

test('single-version-source ignores an unrelated numeric literal', () => {
  const findings = singleVersionSource.run(ctxOf({
    'mac/Sources/LaughCounter/LaughDetector.swift':
      'let threshold = 0.75\n'
      + 'let sampleRate = 48000.0\n',
  }));
  assert.deepEqual(findings, []);
});

test('single-version-source exempts AppDelegate.swift, the one file that builds the label', () => {
  const findings = singleVersionSource.run(ctxOf({
    'mac/Sources/LaughCounter/AppDelegate.swift':
      'let fallback = "v0.3.1 (5)"   // only reachable outside a bundle\n',
  }));
  assert.deepEqual(findings, []);
});

test('single-version-source stays quiet on the real sources', () => {
  assert.deepEqual(singleVersionSource.run(realCtx(...REAL_SWIFT)), []);
});
