---
name: adopt-claudinite
description: Bootstrap Claudinite into a consuming repo — mount, hooks, checks, skills. Use when asked to bootstrap, adopt, or set up Claudinite, or to baseline a repo to pick up updates.
---

Follow [bootstrap.md](../../../../bootstrap.md) — canonical there, and idempotent by design. Under the
vendored mount it is: fetch the canon once (the one network moment), `--init` the pack
declaration + run the adoption interview, vendor the snapshot into tracked
`.claudinite/shared/` (`vendoring/apply-vendor-set.mjs` — whole-set + stamp), track it, register the
single SessionStart orchestrator plus the Stop/PreToolUse hooks at their `shared/` paths, wire the
world- and work-scope sweeps into the project's test/CI flow (a `check_the_world.mjs` step for the
tree and a `ci-work-scope.mjs` step for the change — adding a minimal flow if the repo has none;
the Stop hook runs the work scope too, but only where a session runs), open the
maintenance-enrollment issue, categorize the project, and land the sweep green.

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
