# claude-code-web-users-support pack

What a project can offer the people working on it **from the web** — a Claude Code web session runs
for a signed-in person in a managed container, and a terminal session does neither, so this is where
the capabilities that depend on knowing *who* is here live. Today that is one: each person's
personal interaction preferences, read at session start from a configured store repo by
[`session-start.mjs`](session-start.mjs).

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

## Checks

Both are advisory: a preference store is a nice-to-have, and nothing here may block a session.

| Check | Severity | Reason | Enforcement |
|---|---|---|---|
| `preferences-store-configured` | medium | complexity | check: advisory |
| `preferences-store-file-names` | high | correctness | check: advisory |
