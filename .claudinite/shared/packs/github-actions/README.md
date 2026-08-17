# github-actions pack

Active when the repo has `.github/workflows/*.yml` — the workflow-YAML and Actions-runner platform
behaviours a repo cannot get wrong. **Prose-free**: every rule here has a signature in the workflow
YAML itself, so each rides a check whose failure message *is* the rule. The scheduling behaviour that
is judgment rather than shape — what a `schedule:` trigger actually guarantees — lives in the
[`github-actions-scheduling`](skills/github-actions-scheduling/SKILL.md) skill.

Sibling packs on the same axis: `git-github` (git and GitHub command procedure), and each product's
own `-release` pack (the content of one release pipeline, not the platform under it).

## Checks

| Check | Severity | Reason | Enforcement |
|---|---|---|---|
| `gha/secrets-in-job-if` | high | correctness | check: blocking |
| `gha/run-pipefail` | high | correctness | check: blocking |
| `gha/checkout-submodules` | high | correctness | check: blocking |
| `gha/pages-artifact-symlinks` | high | correctness | check: blocking |
| `gha/no-scheduled-fleet-executor` | medium | correctness | check: blocking |
| `gha/scheduled-failure-escalation` | high | correctness | check: advisory |
| `gha/label-create-before-add` | medium | correctness | check: advisory |
| `gha/unique-automation-branch` | medium | correctness | check: advisory |
| `gha/cron-minute-off-the-hour` | medium | correctness | check: advisory |
