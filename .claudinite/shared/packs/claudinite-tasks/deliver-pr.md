# Delivering a scheduled task's pull request

How an executor subagent delivers the PR its task produced — the AGENT lane of the one
delivery procedure. The CODE lane is `land-pr.mjs` beside this file (Action-side workers
run it); **the two must keep saying the same thing** — a nuance changed in one changes in
the other in the same commit. Your GitHub writes go through the session's MCP tools, and
your pushes ride a credential whose events start workflows normally, so — unlike the code
lane — your PR's checks need no help from you to run.

## The task sets the ceiling; the repo decides the rest

Your task's declared `automerge` is a **ceiling, not a plan** (the legacy
`expected_outcome: 'open-pr'` reads as `nothing`, `'merged-pr'` as `anything`).
On a request item the authorization is the item's **`Merge:` field** instead,
read within that ceiling: absent means `nothing`, `if-narrow` means the
`narrow-diff` composite, and any other value is the policy expression itself.
Whichever source it came from:

- **`nothing`** — open the PR and stop. Never arm auto-merge, never merge. Nothing below
  applies to you.
- **`anything`** — the task *may* land its PR. Whether it actually lands unreviewed is
  **this repo's** setting, read in step 1 — never the task's own knowledge. The same task
  lands itself on one repo and waits for an owner on another, and both are correct.
- **a policy list** (e.g. `['comment-only-changes', 'readme-changes']`) — the task may
  land its PR only when the diff sits inside the policy, and the policy engine decides
  that, never your reading of the diff. Before step 2, run it from the repository root —
  `merge-policy.mjs` at the root of the claudinite-tasks pack (probe
  `.claudinite/shared/packs/claudinite-tasks/merge-policy.mjs`, falling back to
  `packs/claudinite-tasks/merge-policy.mjs` in the canon):

  ```
  node <that file> --base <the PR's base branch> --policy '<the terms, ;-joined>'
  ```

  `AUTOMERGE: no` — leave the PR open for review, quote the verdict line in your wrap-up,
  and stop; a diff wider than its policy waiting for a person is a correct outcome, and
  you never re-shape a change to fit the classifier. `AUTOMERGE: yes` — amend your
  branch's final commit to carry the arming trailer on its own line,
  `Claudinite-Automerge-Policy: <the same expression>`, push, and continue below (the
  `automerge-policy-scope` check re-measures the diff against the trailer, so a
  mis-measured arm goes red instead of merging).

## 1. Read the repo's delivery preference

`.claudinite-settings.json` → `maintenance.delivery`:

- **`auto-merge`** (legacy aliases `auto`, `push`) — go to step 2.
- **`review`** (legacy alias `pr`) — leave the PR open for the owner and stop. Never arm
  it, never merge it, and never read the standing PR as a failure: degrading an
  authorized landing to review is the repo's stated intent, and member config wins.
- **Missing or empty** — proceed as `auto-merge` (the default). Do **not** write the key:
  materializing it is the update converge's job, not yours.
- **Anything else** — someone stated an intent you cannot honour, and guessing could
  deliver its opposite. Leave the PR open (the posture that merges nothing) and name the
  unrecognized value in your wrap-up comment on the work item.

## 2. Arm auto-merge

Arm GitHub's native auto-merge on the PR — **squash**, always. Armed → done: GitHub lands
it once this repo's required checks pass.

## 3. When the arm is rejected

- **"Pull request is in clean status"** — the base branch requires nothing, so auto-merge
  has no queue to wait behind and this arm will be rejected every time. That is a repo
  *shape*, not an error — nothing needs fixing, and the merge is yours to make: once any
  checks that did start on the PR's head have **concluded green**, merge it yourself
  (squash). A repo with no PR checks at all merges as soon as the PR is mergeable.
- **Any other rejection** ("auto-merge is not allowed", "unstable status", …) — judge on
  evidence, exactly as the code lane's landing pass does. Read the workflow runs on the
  PR's **head sha**:
  - A run parked at `action_required` **never ran** — it is neither a pass nor a failure;
    ignore it and judge by the runs that actually executed.
  - Wait (within your run's time budget) for the real runs to conclude. Everything
    concluded, nothing failed, at least one succeeded → merge (squash).
  - Anything genuinely failed (`failure`, `timed_out`, `cancelled`, `startup_failure`),
    or the runs won't conclude inside your budget, or GitHub refuses the merge itself
    (a required gate you could not see) → **leave the PR open** and say why in your
    wrap-up comment, naming the repo settings a human should check: Settings → General →
    "Allow auto-merge", and Settings → Actions → General workflow-approval requirements
    (the usual source of the parked `action_required` run). A PR left open with its
    reason stated is a *delivered* outcome within the ceiling — the trail
    survives and the task's next cycle (or the owner) picks it up; a merge past a red or
    unseen check does not survive anything.

## Never

Merge with anything but squash; merge while a real check is failing or still running;
arm or merge when the repo said `review`; write `maintenance.delivery` yourself; or
manufacture a merge to satisfy the ceiling — "no change" and "left open, reason stated"
are always legal outcomes.
