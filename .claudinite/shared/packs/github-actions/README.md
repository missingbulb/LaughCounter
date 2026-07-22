# github-actions pack

Active when the repo has `.github/workflows/`. Workflow lints only — no prose.

## Checks (hardcoded)

| Check | Enforces (≤5 words) | Severity |
|---|---|---|
| `gha/secrets-in-job-if` | no secrets in job-level if | blocking |
| `gha/run-pipefail` | piped run steps set pipefail | blocking |
| `gha/checkout-submodules` | checkout fetches submodules when present | blocking |
| `gha/scheduled-failure-escalation` | scheduled workflow escalates its failure | advisory |
| `gha/label-create-before-add` | create a label before adding | advisory |
| `gha/unique-automation-branch` | automated branch names are unique | advisory |
| `gha/pages-artifact-symlinks` | Pages upload prunes tooling symlinks | blocking |
| `gha/no-scheduled-fleet-executor` | Claudinite executor stays dispatch-only | blocking |
