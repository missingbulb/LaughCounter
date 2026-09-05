# basics pack

The baseline pack — the `RULES.md` prose every session loads (injected by the pack-prose hook) plus the working-discipline checks. Its subject is **how work is done**, whatever tool is running it. Declared explicitly like every other pack — no pack is active by default; bootstrap seeds the declaration and the nightly baselining backfills it into existing consumers.

## Rules (`RULES.md`)

| Rule | Severity | Reason | Enforcement |
|---|---|---|---|
| Starting any requested change | high | correctness | prose: 59 words |
| Replying to an owner comment | high | complexity | prose: 109 words |
| Acting on a correction | high | correctness | prose: 39 words |
| Acting on a feature | high | correctness | prose: 39 words |
| Acting on a process change | medium | complexity | prose: 67 words |
| Choosing what goes on that ladder | medium | complexity | prose: 82 words |
| Landing a rule anywhere on the ladder | high | correctness | prose: 64 words |
| Building a mechanism for a behavior | medium | complexity | prose: 18 words |
| Building release, deploy, versioning or CI plumbing | medium | complexity | prose: 46 words |
| Finishing a change | high | correctness | prose: 33 words |
| Changing scheduled or unattended machinery | high | correctness | prose: 36 words |
| Planning a migration | medium | complexity | prose: 99 words + skill (`writing-migration-plans`) |
| Adding a legacy tolerance | high | complexity | prose: 59 words |
| Choosing an automerge policy | high | correctness | prose: 65 words |
| Predicting an irreversible change | critical | correctness | prose: 42 words |
| Handing over a wider diff than asked | medium | complexity | prose: 63 words |
| When verifying now is genuinely impossible | high | correctness | prose: 138 words + skill (`verify-in-production`) |
| Finishing a larger element | medium | correctness | prose: 94 words + skill (`production-retrospective`) |
| Receiving feedback that flags a misunderstanding | medium | complexity | prose: 29 words |
| Writing anything | low | complexity | prose: 18 words |
| Auditing an artifact against its source | high | correctness | prose: 35 words |
| Acting on an approval | high | correctness | prose: 69 words |
| Searching for a tool with ToolSearch | medium | complexity | prose: 57 words |
| Calling Edit | low | complexity | prose: 39 words |
| Calling Grep with a context flag | medium | complexity | prose: 51 words |
| Needing exact text from the web | high | correctness | prose: 56 words |
| Hitting a denied fetch | critical | legal | prose: 152 words |
| Scheduling a wake-up with the harness | high | correctness | prose: 60 words |
| Seeing a build, test or CI warning | medium | correctness | prose: 28 words |
| Suppressing a warning | medium | complexity | prose: 74 words + check (`warning-suppression`) |
| Waiving a finding on text | low | complexity | prose: 26 words |
| Working around a vendored check's finding | medium | complexity | prose: 29 words |
| Deferring a warning you can't fix now | medium | complexity | prose: 255 words |
| Spotting a change that should wait | medium | complexity | prose: 46 words + skill (`do-later`) |
| Filing anything into the ad-hoc queue | high | correctness | prose: 125 words |
| Filing an issue under another | medium | complexity | prose: 69 words |
| Handing over a human-only step | high | complexity | prose: 96 words + skill (`writing-handover-issues`) |
| Naming a file, module, or symbol | low | complexity | prose: 22 words |
| Referring to a value from two places | high | correctness | prose: 117 words + check (`shared-constants`) |
| Writing a file that depends on another | medium | complexity | prose: 97 words |
| Committing | medium | complexity | prose: 43 words |
| Depending on platform or runtime behaviour | high | correctness | prose: 31 words |
| Optimising | high | correctness | prose: 53 words |
| Needing a library for a narrow job | medium | complexity | prose: 27 words |
| Answering an edge case a review raised | medium | complexity | prose: 55 words |
| Documenting a procedure | medium | complexity | prose: 40 words |
| Writing code that can silently do nothing | high | correctness | prose: 76 words |
| Persisting anything on a user's machine | medium | correctness | prose: 43 words |
| Changing what you do with user data | critical | legal | prose: 90 words |
| Driving an external runtime repeatedly | low | complexity | prose: 51 words |
| Automating something that needs live conversation context | medium | complexity | prose: 46 words |
| Writing a pipeline step's exit path | medium | correctness | prose: 26 words |
| Piping a long command through tail | medium | correctness | prose: 87 words |
| Killing a process by pattern | high | correctness | prose: 34 words |
| Working in a fresh checkout or sandbox | low | complexity | prose: 54 words |
| Deciding where a config value lives | medium | complexity | prose: 69 words |
| Handling a value that can be unknown | high | correctness | prose: 103 words |
| Writing a comment | low | complexity | prose: 93 words |

Two rules are skills the guard forces for the files they concern: writing a check that scans the
repo ([`writing-repo-scanning-checks`](skills/writing-repo-scanning-checks/SKILL.md), for any coded
or declared check) and editing a `GENERATED` file
([`working-with-generated-files`](skills/working-with-generated-files/SKILL.md)).

## Checks

The working-discipline rules with a deterministic signature. The world rules read repo state; the four work rules judge the change and the session in front of you.

| Check | Severity | Reason | Enforcement |
|---|---|---|---|
| `markdown-link-labels` | low | complexity | check: blocking |
| `declared-check-messages` | medium | complexity | check: blocking |
| `declared-check-spec-keys` | medium | correctness | check: advisory |
| `file-placement` | medium | complexity | check: advisory |
| `shared-constants` | high | correctness | check: blocking |
| `warning-suppression` | medium | complexity | check: blocking |
| `rules-line-length` | low | complexity | check: advisory |
| `claude-md-length` | medium | performance | check: advisory |
| `generated-merge-driver` | medium | correctness | check: advisory |
| `catalog-completeness` | medium | complexity | check: blocking |
| `reference-integrity` | medium | correctness | check: blocking |
| `runnable-doc-commands` | high | correctness | check: blocking |
| `task-lifecycle` | medium | complexity | check: blocking |
| `squash-merge-history` | high | correctness | check: blocking |
| `barrier` | high | complexity | check: blocking |

`barrier` is the one check a project has to configure before it does anything: it enforces a
**directed folder-access graph** the repo declares on this pack's entry as `config.barriers.rules`,
and a repo that declares none is silent rather than failing. [barriers.md](barriers.md) is the whole
vocabulary — the rule forms, how a reference is resolved against the tree, the exception kinds, and
how another pack ships a fixed barrier of its own as manifest data. It arrived here when the
`barriers` pack was absorbed (#1681): no project ever chose that pack, it rode in on the baseline's
`requires` closure, and a separate identity for a mechanism everyone already has bought only a
second catalog row and an adoption question nobody had asked for.
