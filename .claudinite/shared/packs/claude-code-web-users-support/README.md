# claude-code-web-users-support pack

What a project can offer the people working on it **from the web** — a Claude Code web session runs
for a signed-in person in a managed container, and a terminal session does neither, so this is where
the capabilities that depend on knowing *who* is here — or on the managed container they get —
live. Today that is two: each person's personal interaction preferences, read at session start from
a configured store repo by [`session-start.mjs`](session-start.mjs); and
[`environment-setup-command.sh`](environment-setup-command.sh), the generic body a project pastes
into its web environment's **Setup script** field so the image carries the toolchains the base image
doesn't ship. The script's content is the same for every project — it just runs every active pack's
declared `env` install through the engine's `env-requirements.mjs`, so it never changes as
requirements do (bootstrap.md Part 9 walks the setup). Nobody has to go looking for that body:
the pack's `adoptionHandover` step has the filing session quote it inline, so the issue asking
for the paste carries the block to copy. The file stays the canonical copy because core may not
name a pack — `bootstrap.md` and the engine's env check reach it by its unique filename.

Declared, and seeded by `--init`. The pack holds an **address**, not the content: `config.repo` (and
an optional `config.path`, default `preferences`) name the store that holds one `<email>.md` per
person. Every miss — no identity, no configured store, no file, a failed fetch — is one plain-text
note and the session proceeds on default interaction behaviour.

Preferences are **personal, not project conventions**: conventions belong to the packs that own
each subject and load as prose, while these travel with a person across every project they work
in, and two people on one project can want different things. Reading is local-first — when this
repo *is* the store, the working copy wins over the default branch, so an edit in progress is
what the session sees. Being the store also constrains the tree: the file name is the whole
address, so the store is flat and each name is one person's exact identity, which
[`worldRules/store-file-names.mjs`](worldRules/store-file-names.mjs) explains and audits.

## Rules (`RULES.md`)

| Rule | Severity | Reason | Enforcement |
|---|---|---|---|
| Changing a person's preferences | medium | complexity | prose: 53 words |
| A person's first preferences file | high | correctness | prose: 44 words + check (`preferences-store-file-names`) |
| A web session's missing toolchain | medium | complexity | prose: 38 words |

## Checks

Both are advisory: a preference store is a nice-to-have, and nothing here may block a session.

| Check | Severity | Reason | Enforcement |
|---|---|---|---|
| `preferences-store-configured` | medium | complexity | check: advisory |
| `preferences-store-file-names` | high | correctness | check: advisory |
