---
name: learning-a-technology
description: Teach a repo a new technology for a job of its own — research it against the vendor's live documentation, capture what is portable as a technology skill with declared checks, and wire the project's use of it as a task in its structural local pack. Use when asked to make a repo do something with a technology nobody there has used yet (host it on X, send through Y, publish to Z), or to "research how to do this correctly" and "create a skill" for it.
metadata:
  force-load-on-prompts-matching:
    - '/\bresearch\b[\s\S]*\b(create|write|add|make)\b[^.]*\bskill\b/i'
    - '/\b(create|write|add|make)\b[^.]*\bskill\b[\s\S]*\bresearch\b/i'
    - '/\blearn(ing)? (a |the |this )?(new )?technolog(y|ies)\b/i'
---

# Learning a technology

An ask of this shape has two halves, and the work fails when they are written as one: a
**project job** ("host the site on Cloudflare", "email me three repos every morning") and a
**technology** nobody here has used yet (Cloudflare Pages, Cloudflare Email Service). The job is
this repo's. The technology knowledge is the fleet's, and it travels only if it is written to be
lifted out of here without a rewrite. Every step below keeps the two apart.

## 1. Before researching: the problem, the network, the credential

- **Agree the problem first** — the working-discipline rule for starting any change applies
  unchanged: what is the job for, and is this technology the best way to do it? An owner who
  names a vendor has usually already decided; confirm that in a sentence and move on.

- **Probe egress before you research, and stop on a block.** Run this against the vendor's
  documentation host before reading anything:

  ```
  curl -sS -o /dev/null --max-time 15 -w '%{http_code}\n' https://developers.example.com/
  ```

  `200` — research. `CONNECT tunnel failed, response 403`, `EGRESS_BLOCKED`, or a `000` with a
  proxy error — the environment's network policy blocks the host, and no alternate source or
  later pass gets past it (`fetching-from-the-web`). Ask the owner one `AskUserQuestion` before
  going further: widen the environment's network policy for the vendor's hosts and restart the
  session, or accept a skill written from memory. Never take the second road silently — a
  technology skill is a document later sessions trust as verified, so one written from memory
  says under `## Verified` that nothing was, and the date egress was blocked, and its reader
  knows every claim is unconfirmed. (1)

- **Verify the credential before writing anything against it.** Find where the session or the
  Action holds it (an environment variable named in the environment's setup; a repo secret
  reaches only a task's code-work, per [writing-tasks](../writing-tasks/SKILL.md)), never print
  it, and make the vendor's token-verification or cheapest read-only call first. Record which
  permissions the job needs and whether this token has them; a token short of a permission is a
  handover step for the owner (`writing-handover-issues`), never something the skill works
  around.

## 2. Split the ask: the portable skill and the project's task

| | The technology skill | The project task |
|---|---|---|
| Knows | how the vendor's mechanism works, its API shape, minimum permissions, gotchas, the minimal parameterised code | which repos, which recipient, which folder, cadence, the secret's name, the automerge prediction |
| Never knows | this repo's name, its folders, its recipients, its packs | how the vendor's API is called — it passes parameters to the skill's code |
| Lives in | `<local pack>/skills/<technology>/`, self-contained | `<local pack>/tasks/<job>/` |
| Read by | any session in any repo that adopts the technology | this repo's executor and the sessions maintaining the worker |

**Classify the task before writing it**, from the pack catalog — every canon pack, not only the
mounted ones — and record the verdict in the pack's `references.md` entry for the task, where the
promote stage reads it:

- **Ad-hoc to this project** — a job only this repo has. It stays in the local pack, and
  promotion lifts the skill alone.
- **A canon pack's territory** — release, deploy or versioning plumbing belongs to the pack that
  owns publishing this kind of artifact; a sweep over every member belongs to the fleet pack.
  Build the task here anyway (a member never pushes to the canon), name the target pack in the
  entry, and where that pack's stated territory is merely too narrow, say so rather than route
  around it. The working-discipline rule holds: copying a mechanic from a sibling repo is the
  tell that it belongs centrally, so report the gap instead of authoring a third copy.

A technology never mints a local pack of its own —
[extracting-lessons.md](../../extracting-lessons.md) owns that bar and the ladder the lesson
descends. (2)

## 3. Research: live documentation, exact bytes, a real run

- Read the vendor's documentation from the live site, `curl`ed into the scratchpad and read from
  disk — a search snippet or a summarising fetch is not a source.
- Write only what the documentation does not carry: the failure modes met here, the gotchas, the
  exact path that was run. A procedure the vendor already documents is a link, not prose.
- **Run every call the skill teaches, once, for real** — the smallest real effect the vendor
  allows: a token verification, a dry-run, a send to the owner's own address, a deploy of a
  preview. A path that was not run is not taught; where it cannot be run from here, the skill
  says so beside the step.
- Record both in the skill: `## Sources`, one line per document with its URL and the date it was
  fetched, and `## Verified`, what was run, when, and what came back.

## 4. Author the technology skill

- **One folder, nothing pointing out of it**: `skills/<technology>/` holds `SKILL.md`, its
  `declared-checks.json`, its code, and its tests. A relative link or import that leaves the
  folder dangles the moment the folder is lifted, and the checks in this folder hold that line.
  Name other skills rather than linking them.
- **Mark it** — the frontmatter carries the technology under `metadata`, which is what the checks
  key on:

  ```yaml
  metadata:
    technology: Cloudflare Email Service
  ```

- **Scope it to the use case plus its obvious generalisations** — the send this job needs and the
  parameters a sibling job would obviously vary, never the vendor's whole surface.
- **Sections, in this order**: when to use it; the credential — where it lives, the minimum
  permissions, the verification call; the mechanism, with every invocation as a literal fenced
  command the reader can run; gotchas; `## Sources`; `## Verified`.
- **Code**: one parameterised module beside `SKILL.md` that takes everything project-specific as
  arguments or environment — recipient, target, dry-run — and reads no project config itself.
- **Checks**: as many declared checks as the documentation warrants, in the skill's own
  `declared-checks.json`, each with a fixture beside it — a required header or field, a forbidden
  default, a size or rate limit, a format the API rejects: anything whose violation leaves a mark
  in the tree.
- **Rationale**: entries keyed `<technology>-n` in the pack's `references.md`, each citing the
  document it derives from; they lift with the skill.

## 5. Author the task

[writing-tasks](../writing-tasks/SKILL.md) owns the contract. What this shape of work tends to
get wrong:

- **Code-only where the job is deterministic** (`agent_model: none`). The skill is then for the
  sessions that maintain the worker, so the task's `README.md` names it.
- **The worker reaches the skill's code through one path constant at its top**, and nothing else
  in the task spells that path: promotion moves the skill's folder, and this is the one line that
  changes. (3)
- **The job's parameters ride the pack entry's config or the item's Context**, never the
  technology code — which is what keeps the code liftable.
- **Take the owner's cadence and gating at their word** — a nightly send the owner wants
  unconditionally has no precondition to negotiate.
- **Recreating an existing flow means recreating its guarantees, not its files**: list what the
  old flow promised (the version bump, no deploy loop, the token injection, the publish set),
  make the new one meet each, then delete the old flow and correct every self-description it
  falsifies in the same commit.

## 6. Watch it work now, and hand over what it touched

- Force the task and watch its item to a terminal state before calling the change done. An effect
  only observable in production is `verify-in-production`'s to file, after the merge.
- The handover names, per folder, what changed — and says which of the verdicts in step 2 the
  task got, so the reviewer reads the split rather than reconstructs it.
