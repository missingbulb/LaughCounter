// "Don't prune a `.gitignore` section while its artifacts are still on disk" as
// a check: no build artifact, tool cache or editor droppings may be *visible to
// git* — neither tracked, nor sitting untracked with nothing ignoring it.
//
// The rule's failure mode is silent by construction. Removing a toolchain (the
// Python reference, a build system, a generator) invites tidying its ignore
// rules away in the same commit, but the artifacts it already produced are still
// untracked in the worktree. The moment those rules go, the next `git add -A`
// sweeps them *into* the very commit meant to remove them and nothing complains:
// the commit is valid, the tests pass, and the junk shows up only as an inflated
// file count in the diff a reviewer reads.
//
// The engine's file set is exactly the right instrument, which is why this is
// checkable at all. `ctx.files` is `git ls-files` plus `git ls-files --others
// --exclude-standard` — tracked files, plus untracked ones *that nothing
// ignores*. So an artifact enters scope the instant its ignore rule is pruned,
// one step BEFORE the `git add -A` that would commit it, and stays in scope
// afterwards if it was committed anyway. Both halves of the failure, one list.
//
// A positive-whitelist inversion is not available here — "what may exist in the
// tree" is genuinely open-ended (that is the carve-out RULES.md names), so this
// enumerates the artifact classes instead. That makes the list the check's one
// weak point, so it is kept to path shapes that are *never* authored source: a
// compiler's output directory, a tool's cache, a per-user editor scratch file.
// A class outside it is still the prose's business.
//
// One finding per artifact ROOT, not per file: an unignored `node_modules/` is
// one mistake, not five thousand findings.
//
// Dependency-free by design (a local pack must load without the canon mount),
// so the finding object is built by hand rather than via the engine helper.

// Each entry matches somewhere inside the repo-relative path. A pattern whose
// match ends in `/` names a directory: the finding is reported once, against the
// path truncated at that directory. Anything else names a single file.
const ARTIFACTS = [
  // Build output — the compiler's, the packager's, Xcode's.
  [/(?:^|\/)\.build\//, 'a SwiftPM build directory (.build/)'],
  [/(?:^|\/)\.swiftpm\//, "Xcode's SwiftPM state (.swiftpm/)"],
  [/(?:^|\/)DerivedData\//, "Xcode's DerivedData"],
  [/(?:^|\/)build\//, 'a build output directory (build/)'],
  [/(?:^|\/)dist\//, 'a packaging output directory (dist/)'],
  // Interpreter and tool caches.
  [/(?:^|\/)__pycache__\//, 'a Python bytecode cache (__pycache__/)'],
  [/(?:^|\/)\.(?:pytest|mypy|ruff)_cache\//, "a Python tool's cache directory"],
  [/(?:^|\/)[^/]+\.egg-info\//, 'a Python packaging egg-info directory'],
  [/(?:^|\/)node_modules\//, 'an installed npm tree (node_modules/)'],
  // Per-user and per-machine droppings.
  [/(?:^|\/)xcuserdata\//, 'per-user Xcode state (xcuserdata/)'],
  [/(?:^|\/)\.DS_Store$/, 'a Finder metadata file (.DS_Store)'],
  [/\.xcuserstate$/, 'per-user Xcode UI state (.xcuserstate)'],
  [/\.py[co]$/, 'compiled Python bytecode'],
];

const rule = {
  id: 'laughcounter/no-loose-build-artifacts',
  severity: 'blocking',
  description: 'No build artifact, tool cache or editor dropping is visible to git (tracked, or untracked with nothing ignoring it)',
  doc: '.claudinite/local/packs/laughcounter/RULES.md',
  why: 'an artifact git can see is one `git add -A` away from being swept into the commit that was meant to remove it — the commit stays valid and the tests still pass, so it surfaces only as an inflated file count in the diff a reviewer reads',

  run(ctx) {
    const out = [];
    const seen = new Set();
    for (const file of ctx.files) {
      for (const [pattern, what] of ARTIFACTS) {
        const m = pattern.exec(file);
        if (m === null) continue;
        const matched = m[0];
        // A directory match collapses to its root so one stray tree is one finding.
        const key = matched.endsWith('/') ? file.slice(0, m.index + matched.length) : file;
        if (seen.has(key)) break;
        seen.add(key);
        out.push({
          rule: rule.id,
          severity: rule.severity,
          file: key,
          line: null,
          what: `${what} is visible to git at \`${key}\``,
          why: rule.why,
          fix: 'delete it from the worktree (`git clean -fdx` the path), then make sure `.gitignore` still ignores it — a pruned ignore rule is what makes a leftover artifact visible again, so remove the artifacts first and the ignore lines second, never the other way round',
          doc: rule.doc,
        });
        break;
      }
    }
    return out;
  },
};

export default rule;
