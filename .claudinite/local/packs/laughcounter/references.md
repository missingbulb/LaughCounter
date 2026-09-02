# laughcounter — references

Rationale for the marked rules in `RULES.md`. Exists for maintenance and review
— the periodic pass that asks whether a rule still earns its place — never for
daily agentic work: no rule sends its reader here, and no session loads it.

- **(RULES-1)** Diagnosing the `installTap` crash stalled on "which binary is
  installed?", and the answer had to be reconstructed by grepping a crash
  report's symbol names for whether `finishListening` took a `generation:`
  argument, because the menu header said only "LaughCounter". Separately,
  several genuinely different builds all reported `0.2.1`, because the release
  workflow keys its Release on `v<version>` read from `mac/Resources/Info.plist`
  — so a merge that leaves `CFBundleShortVersionString` alone refreshes the
  same Release, and the DMG behind the `latest/download` link changes identity
  without changing its name. (#61, #74, #75)
- **(RULES-2)** PR #138 sat unmerged for a day because a run read its task
  file's blanket "never hand-merge" as covering the auto-merge rejection too.
  Three cycles running spent their budget hunting the PR API for a branch that
  had already merged, instead of fetching `main` and re-running the check
  against it. (#127, #128, #129, #130, #133, #134, #137, #138)
- **(RULES-3)** The first draft of `macos-audio/swift-toolchain-gate` flagged
  `mac/scripts/diagnose-mic.sh:175`, a `#` comment that exists purely to warn
  the next reader that `command -v swift` is not a usable test. (#152, #159)
- **(RULES-4)** All six of 2026-08-09's scheduled sessions hit this: a second
  `<github-trigger-context>` for the same issue arrived mid-run. (#149, #150,
  #151, #152, #154, #155)
- **(RULES-5)** Without the direct invocation, a session reaches for `--help`
  (which prints nothing for a plain ESM export) or writes a scratchpad file to
  probe the call before finding the real one. (#185)
- **(RULES-6)** `pmset displaysleepnow      # screen goes dark, wake it
  whenever you like` (from the display-sleep repro this repo's own audio
  diagnostics use) ran `wake it whenever you like` as a second command and
  errored `command not found: wake`. (#76)
