---
name: adopt-claudinite
description: Bootstrap Claudinite into a consuming repo — mount, hooks, checks, skills. Use when asked to bootstrap, adopt, or set up Claudinite, or to baseline a repo to pick up updates.
---

Follow [bootstrap.md](../../../../bootstrap.md)'s **fast path** — canonical there, and idempotent
by design. Everything mechanical is one `bootstrap.mjs` invocation from the fetched canon, so the
adoption is seven steps: open the adoption issue **first** (the work-scope sweep blocks a commit
that references no issue), fetch the canon and run the script, ask **every** pending interview
question it reports in one batched `AskUserQuestion` pass (up to 4 per call, the project-class
question folded in) and record the answers via `--answer` re-runs, **create the executor routine
and write its endpoint into the declaration** (Part 6 — this session's work, and before the
commit so it lands in the same PR), land the adoption as one commit referencing the issue,
capture the adoption session itself once the PR lands (the fast path's capture step — no
SessionEnd hook was loaded when this session started, so nothing else will), then file **one
issue** carrying the script's HANDOVER block, a checkbox per step. Never re-enact the doc's parts
step by step — they document what the script converges.

Two things the fast path spells out and a session keeps getting wrong. A fresh project's
interview takes **two** passes, because declaring the project-class pack pulls in a `requires`
closure whose questions cannot exist until it is declared — and never more, because an answer is
stored verbatim, so an open-ended one needs no clarifying popup. And the executor routine is
**unfinished, not human-only**: `create_trigger` makes it, the SETUP block in its own prompt
carries the model and repo binding the API cannot set, and only the `CCR_ROUTINE_TOKEN` secret is
a step the hand-over issue takes (#1167).

Bootstrap is the one place `apply-vendor-set.mjs` is the right tool, and only because the repo is at
version zero: it stamps every declared pack at the newest version, and with no older state there is
nothing to skip. Read the next section before reaching for it anywhere else.

**Refreshing** an already-vendored repo is **not** a session's job, and must not be hand-rolled.
Force the repo's own update task and let the flow do it — through the **GitHub MCP tools**, which is
the surface a session actually has (an unattended or web session carries no `gh` CLI, and `curl` to
`api.github.com` is proxy-blocked there, so a shell recipe fails exactly where this is most needed):

```
actions_run_trigger(method: "run_workflow", owner: …, repo: …,
                    workflow_id: "claudinite-scheduler.yml",
                    ref: "main",                                  # see below
                    inputs: { wake: "update" })
```

`ref` is the **default branch**, not whatever branch you are on: a `workflow_dispatch` always runs the
workflow definition from the default branch, so dispatching against a feature branch neither picks up
a workflow you only added there nor changes which definition runs. In a local session with `gh`
authenticated, `gh workflow run claudinite-scheduler.yml -f wake=update` is the same call.

Then **watch it to a terminal state** — a forced run is how you see a change to scheduled machinery
work *now*, and parking it on "check tomorrow" is the failure this lever exists to prevent. A
dispatched run is not attached to a PR, so read it with `get_job_logs(run_id, failed_only: true)`
("0 failed jobs" means green) rather than any PR-scoped check query.

**Never refresh a stamped repo by running `apply-vendor-set.mjs` against it.** It advances every
declared pack's stamp to the newest version without applying the records in between, and
`migrationApplies` is `want > have` — so each record it skips stops applying *permanently*, not just
this cycle. The repo is left claiming a version whose shape it was never migrated into, and because
the stamp is the only thing that remembers, nothing downstream can tell. This is silent, and it does
not self-heal.

The update flow exists precisely because a refresh is more than laying files down: it applies the
version-ranged records, opens one reviewable PR, withholds anything bound for `.github/workflows/`
that the Action token cannot write, and ends at the apply stage when a record's rules need a reader.
A session that re-vendors by hand does none of that while looking like it succeeded.

**Never** hand-convert a legacy (fetch-at-session-start) member to the
vendored mount — that conversion is the gated flip note the nightly applies
([vendoring/DESIGN.md](../../../../vendoring/DESIGN.md), phase 2); until then legacy members are maintained
per bootstrap.md's transition appendix.
