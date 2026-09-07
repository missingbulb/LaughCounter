# task-janitor

## What this task is

A **fallback**. Every rule it runs repairs something that already went wrong — a
label swap that tore, a session that died, a park nobody answered, a pull request
somebody resolved without closing the item behind it. No stage of the healthy flow
of a task runs here: an item the machinery handled correctly is settled by whoever
handled it, long before this task's next pass. A new rule is therefore a claim that
a failure mode exists and that nothing nearer to it can close the item out.

It reads only OPEN items. An item somebody closed is finished, park label and all:
a person ending a park by closing its issue has answered it, and this task neither
reopens nor re-labels nor re-announces one.

## Why the declaration reads as it does

Carried over from the declaration's comments when it became `task.json`.

basics task: task-janitor — the THIRD responsibility of the scheduled-task
machinery (owner, 2026-08-06). The scheduler run CREATES and readies work items, the
executor EXECUTES exactly the one item it picked, and this task — alone —
cleans up after both: items stuck ready past their period, items left wearing
no state label by a torn transition, and a health review of the open set.
Neither the scheduler run nor the executor does any of that; a task execution cares only
about its own item, and recovery lives here, in code, once a day.

It also sweeps what the retired slot mechanism left behind: the last slot runs
filed `[claudinite-task]` dispatch issues in members, and nothing else closes
them out. That half retires when the fleet's are gone, not before.

The scheduler run reclaims a dead executor claim itself, hourly — this task is the
slower backstop for what the scheduler run's deterministic label mechanics cannot see.

`agent_model: 'none'` + code_work: the whole pass is deterministic code the
executor runs as code-work — no agent phase, fully automatic.

The queue's own health is what this reads, and the queue is exactly what keeps
moving on a repo that is otherwise silent — so no repo-side condition gates it.
One repo-wide issue search plus a handful of label/comment writes — seconds.
