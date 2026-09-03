# verify-production — coded production validations

The queue's coded verification lane (#1530). A change whose proof lives at a URL — a
Pages site, a deployed config, a published module — cannot be verified by an agent
session, which has no egress. This task is the runner for those: the verification
issue carries declarative probes, and the worker fetches and judges them as
code-work, Action-side, where egress exists.

The filing form — when to file one at all, and the brief's fields — is the basics
pack's [verify-in-production](../../../basics/skills/verify-in-production/SKILL.md)
skill. An issue routes here by naming `Task: claudinite-tasks/verify-production`
beside its mark.

## The spec the worker reads

Parsed from the human half of the issue body by [`probes.mjs`](probes.mjs), which
is also where the assertion grammar is defined and documented:

```
Original-issue: #<n>
Task: claudinite-tasks/verify-production
Live-probe: <url> :: <assertion>
Verify-probe: <url> :: <assertion>
Retry-every: <count> <minutes|hours|days|weeks>
```

Both probe classes are required, and the difference is the whole design: a failing
`Live-probe:` means the release has not landed (re-arm and come back), a failing
`Verify-probe:` — judged only once liveness passes — means a real fault in
production. Without the gate the two are indistinguishable, and a verify failure
would reopen the original issue over a release that simply has not happened.

## The four verdicts

- **invalid** — the spec is unreadable: the worker exits non-zero with a triage
  marker naming every problem, and the item parks.
- **not yet live** — the worker prints the `claudinite-requeue:` marker with
  now + `Retry-every:` and exits clean; the executor re-arms the item's
  `Not-before` and returns it to blocked.
- **pass** — the evidence actually read is commented on the item; the executor
  closes it done.
- **fail** — `Original-issue:` is reopened with what was asserted and what was
  read; the item links it and closes done — the verification did its job by
  finding the fault.

## Watching a fresh one fail

A coded run costs seconds, so a new verification should be watched failing before
its release lands: dispatch the scheduler workflow (its `workflow_dispatch`), and
the adoption-plus-drain executes the probes immediately. The run reporting
**not yet live** is the see-it-fail proof — the probes execute and do not pass
vacuously — and the same item then flips on its own once the release is live.

## Why the declaration reads as it does

Carried over from the declaration's comments when it became `task.json`.

The coded production-validation task (#1530). A verification issue that names
this task (`Task: claudinite-tasks/verify-production`) carries declarative URL
probes; the worker fetches and judges them as code-work — Action-side, where
egress exists — so no agent session is ever spent, and no egress wall is ever
hit. The grammar and the verdict flow are the worker's (see README.md beside
it); the filing form is the basics pack's verify-in-production skill.

MANUAL: an item exists only because a verification was filed and marked —
there is nothing to put on a calendar.
A filed production verification is its own mandate.
A handful of bounded HTTP fetches plus a few issue writes — minutes at most.
