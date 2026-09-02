# References — rationale behind this pack's rules and checks

Maintenance and review material for the `writing-pack-prose` references convention: each entry
carries the reason a rule or check exists, written so a periodic review can reaffirm — or
retire — it. Entry keys are file-scoped stable identifiers (gaps allowed, never renumbered): an
end-of-line `(n)` marker in `RULES.md` cites `RULES-n`, one in a skill cites
`<skill-name>-n`, and `check:` entries cover checks. No session loads this file for daily work.
- **(check:gha/secrets-in-job-if)** The behaviour: `secrets.*` is not available in a job-level
  `if:`, so a job gated on a secret cannot evaluate its condition and **fails red** rather than
  skipping. The point of the repository-variable form the check's fix names is that the job is
  **skipped (neutral)** until configured, which keeps the default branch green for anyone who
  has not set the optional integration up — the reason the check is blocking rather than
  advisory. Converted from `git-github-advanced`'s prose in #552, which deletes a paragraph
  whole once a check covers it — the failure message owns the rule and the check's own text
  owns the remedy, so what is recorded here is the platform behaviour the check encodes and the
  condition that would retire it. Reaffirm against GitHub's context-availability documentation;
  retire only if secrets become readable in a job-level `if:`.
- **(check:gha/run-pipefail)** The behaviour: GitHub's implicit run shell is `bash -e {0}` —
  **without** `pipefail` — so a step piping through another command (`cmd 2>&1 | tee log`)
  reports the *last* command's exit code and a failing command still shows the step green.
  Setting `defaults.run.shell: bash` makes GitHub run the step as `bash --noprofile --norc -eo
  pipefail {0}`; that exact expansion is the fact to re-verify, since it is what makes the
  remedy work. Converted from `git-github-advanced`'s prose in #552, which deletes a paragraph
  whole once a check covers it — the failure message owns the rule and the check's own text
  owns the remedy, so what is recorded here is the platform behaviour the check encodes and the
  condition that would retire it. Reaffirm against GitHub's documented default and `bash` shell
  expansion; retire only if the implicit shell gains `pipefail`.
- **(check:gha/checkout-submodules)** The behaviour: `actions/checkout` does **not** fetch
  submodules by default, so the submodule directory is an empty folder in CI. The failure class
  is what earns a blocking check — a gate reading submodule content does not fail, it **passes
  vacuously**: the check becomes a no-op rather than a signal, which is invisible in a green
  run. Converted from `git-github-advanced`'s prose in #552, which deletes a paragraph whole
  once a check covers it — the failure message owns the rule and the check's own text owns the
  remedy, so what is recorded here is the platform behaviour the check encodes and the
  condition that would retire it. Reaffirm against `actions/checkout`'s documented defaults;
  retire only if it starts fetching submodules by default.
- **(check:gha/label-create-before-add)** The behaviour: unlike applying an already-defined
  label, GitHub will not create a label on demand, so `gh issue edit --add-label "<name>"`
  fails when the label does not exist yet. What makes it easy to miss in review is the timing —
  a workflow introducing a new label breaks the **first** time it runs, never in the diff.
  Converted from `git-github-advanced`'s prose in #552, which deletes a paragraph whole once a
  check covers it — the failure message owns the rule and the check's own text owns the remedy,
  so what is recorded here is the platform behaviour the check encodes and the condition that
  would retire it. Reaffirm against `gh`'s behaviour for an undefined label; retire only if
  `--add-label` gains create-on-demand.
- **(merge-to-main-1)** The capture step runs **here, in-session, because it needs the live
  transcript** — nothing later can reach it, which is why this is a step of the merge rather
  than something scheduled. Extraction is deliberately not done here: the lessons pass happens
  later in the `claudinite-growth` pack's `growth-extract` task, over the captured logs, so
  this step stays deterministic and seconds-long. Recovered from the skill's own pre-#1092
  text, cut when `verify-in-production` was split out of this skill (`8da4c916`). Reaffirm
  while `capture-log.mjs` reads the session transcript and `growth-extract` owns the
  conversation half; retire if capture stops needing a live session.
