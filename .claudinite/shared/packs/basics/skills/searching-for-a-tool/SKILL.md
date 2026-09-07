---
name: searching-for-a-tool
description: Finding a harness tool by name — the select form for a deferred tool, and what an empty search means. Use before any ToolSearch, and when a search finds nothing.
metadata:
  force-load-on-tool-calls:
    - 'ToolSearch'
  force-load-on-tool-results-matching:
    - 'ToolSearch /no (matching )?tools/i'
---

# Searching for a tool

- **A search that finds nothing** is evidence about your query, not about the environment: vary
  the query before concluding a capability is absent, and try the tool before telling the owner a
  step is theirs.
- **`select:` matches the fully-qualified name only** — `select:mcp__<server>__<tool>`, copied off
  the deferred-tools listing. A short name after `select:` returns "no matching tools" while the
  tool sits in the listing, so reach for it when you have the server, or to load several at once.
- **A bare short name is a keyword query, and resolves** — `get_teams` on its own returns the
  tool. It is the form to use when you know the name but not the server. (1)
- **A server whose whole roster the deferred-tools listing already names** is the one exception: one
  miss there is the answer, so read the roster rather than rephrase the query.
