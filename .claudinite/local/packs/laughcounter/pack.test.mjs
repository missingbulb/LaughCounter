// Red-first fixtures for the laughcounter pack's checks: each rule must fire on
// a violating tree and stay quiet on the repo's real, clean one. Run directly:
//
//   node --test .claudinite/local/packs/laughcounter/pack.test.mjs
//
// They live here rather than in tests/ (`claudinite-isolation`), matching the
// on-device-privacy pack beside them. The fake ctx is the slice of the engine's
// context a check actually uses — for a rule that judges paths, just `files` —
// so these tests need neither the canon mount nor a git checkout. The one test
// that asserts the check is quiet on this repo builds its file list from `git
// ls-files` plus the unignored-untracked set, exactly as buildContext does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import noLooseBuildArtifacts from './no-loose-build-artifacts.mjs';

const repoRoot = dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))));

// Fixture ctx: a path-only tree is all a path-shape rule reads.
const ctxOfPaths = (files) => ({ files, read: () => null });

const git = (...args) =>
  execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).split('\n').filter(Boolean);

test('no-loose-build-artifacts fires on every artifact class it names', () => {
  const findings = noLooseBuildArtifacts.run(ctxOfPaths([
    'mac/.build/release/LaughCounter',
    'mac/.swiftpm/xcode/package.xcworkspace/contents.xcworkspacedata',
    'mac/dist/LaughCounter.app/Contents/MacOS/LaughCounter',
    'build/stamp.txt',
    'DerivedData/LaughCounter/Index/info.plist',
    'tools/__pycache__/detector.cpython-311.pyc',
    'tools/.pytest_cache/CACHEDIR.TAG',
    'tools/laughcounter.egg-info/PKG-INFO',
    'site/node_modules/left-pad/index.js',
    'mac/LaughCounter.xcodeproj/project.xcworkspace/xcuserdata/me.xcuserdatad/UserInterfaceState',
    'mac/.DS_Store',
    'mac/LaughCounter.xcodeproj/project.xcworkspace/me.xcuserstate',
    'tools/detector.pyo',
  ]));
  assert.equal(findings.length, 13);
  assert.equal(findings.every((f) => f.severity === 'blocking'), true);
  assert.match(findings[0].what, /SwiftPM build directory/);
  assert.match(findings[5].what, /Python bytecode cache/);
  assert.match(findings[10].what, /Finder metadata/);
  // The fix has to name the ordering, or the finding leaves the agent to guess.
  assert.match(findings[0].fix, /artifacts first and the ignore lines second/);
});

// The failure the rule was written for: the ignore rule is pruned in the same
// commit as the toolchain, and the artifacts it ignored are still on disk — so
// they arrive as untracked-and-no-longer-ignored, which is exactly what
// buildContext puts in ctx.files.
test('no-loose-build-artifacts catches a pruned ignore rule before the git add -A', () => {
  const findings = noLooseBuildArtifacts.run(ctxOfPaths([
    'mac/Sources/LaughCounter/main.swift',
    'tools/__pycache__/detector.cpython-311.pyc',
  ]));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, 'tools/__pycache__/');
});

// An unignored tree is one mistake, not one finding per file in it.
test('no-loose-build-artifacts reports one finding per artifact root', () => {
  const findings = noLooseBuildArtifacts.run(ctxOfPaths([
    'site/node_modules/left-pad/index.js',
    'site/node_modules/left-pad/package.json',
    'site/node_modules/.package-lock.json',
    'mac/.build/release/LaughCounter',
    'mac/.build/release/LaughCounter.swiftmodule',
  ]));
  assert.deepEqual(findings.map((f) => f.file), ['site/node_modules/', 'mac/.build/']);
});

// The false alarms the class list must not raise: source paths that merely read
// like build output.
test('no-loose-build-artifacts stays quiet on authored files that only look like artifacts', () => {
  const findings = noLooseBuildArtifacts.run(ctxOfPaths([
    '.github/workflows/build-macos-dmg.yml',
    'mac/scripts/build-app.sh',
    'mac/Sources/LaughCounter/AppLog.swift',
    'docs/DESIGN-AND-TRADEOFFS.md',
    'mac/Resources/Info.plist',
    'tools/distribution.md',
    'mac/Sources/Builder/Build.swift',
    'docs/building/from-source.md',
    'docs/distribution/overview.md',
  ]));
  assert.deepEqual(findings, []);
});

test('no-loose-build-artifacts stays quiet on this repo as it stands', () => {
  const files = [...git('ls-files'), ...git('ls-files', '--others', '--exclude-standard')]
    .filter((f) => !f.startsWith('.claudinite/shared/'));
  const findings = noLooseBuildArtifacts.run(ctxOfPaths(files));
  assert.deepEqual(findings, []);
});
