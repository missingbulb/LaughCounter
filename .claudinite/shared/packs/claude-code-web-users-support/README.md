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

## Rules (`RULES.md`)

| Rule | Severity | Reason | Enforcement |
|---|---|---|---|
| Personal interaction preferences | medium | complexity | prose: 277 words |
| If this repo is the store | high | correctness | prose: 104 words + check (`preferences-store-file-names`) |
| Adding or changing a preference | medium | complexity | prose: 67 words |
| The web environment's Setup script | medium | complexity | prose: 98 words |

## Checks

Both are advisory: a preference store is a nice-to-have, and nothing here may block a session.

| Check | Severity | Reason | Enforcement |
|---|---|---|---|
| `preferences-store-configured` | medium | complexity | check: advisory |
| `preferences-store-file-names` | high | correctness | check: advisory |
