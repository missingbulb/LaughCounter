# Usage fold — count skill loads and their denominators from the captured logs

**This task runs no agent.** It is `agent_model: none` with `agent_preprocessing: node worker.mjs`, so the whole pass is the deterministic [`worker.mjs`](worker.mjs) the scheduler runs as a subprocess, which calls its sibling in this folder, the counting and folding core ([`fold-usage.mjs`](fold-usage.mjs)). This file is the human-facing record of what that worker does; there is no dispatch issue and no subagent.

## What it does

Daily: fetch this repo's orphan `conversation-logs` branch, count each capture file still inside the retention window, and regenerate `.claudinite/local/usage.GENERATED.json` on an auto-merging PR. A byte-identical recompute opens nothing.

What it counts, per bucket:

- **`skillLoads`**, per skill name — `Skill` tool-use entries, plus user-typed `/command`s naming a skill this repo mounts (built-in CLI commands never match). Subagent streams included: a subagent loading a skill is a load.
- **`captures`** — capture events folded. **`merges`** — the subset with an issue behind them (issue `0` means none).
- **`sessions`** — distinct session ids; one session can capture more than once.
- **`userMessages`** — genuine human turns. **`userCommands`** — every typed `/command`.

The denominators are the point. A raw load count cannot tell healthy-rare from broken — a version-bump skill loading rarely is fine — so the question is loads *against the sessions where that skill's own declared trigger plausibly applied.*

## Two tiers, two different mechanisms

- **Days** are recomputed **from scratch, every run**, from the live capture files. No ingest ledger, no double-count risk, and a counting-bug fix self-heals the whole visible window on its next run. A day row drops out when its raw files age past retention — its content lives on in its week row.
- **Weeks** are appended **once**, past a single `foldedThrough` watermark: every day that has closed since the mark is added to its ISO week and the mark advances. Days close strictly in order, so a monotone mark is the entire exactly-once mechanism.

Week rows are frozen by that trade: a counting bug found later heals the day window automatically, but weeks folded under the old counting keep it — re-freezing would need raw data the retention TTL deliberately destroyed. Git history records which commit folded what.

## The file is GENERATED

`.claudinite/local/usage.GENERATED.json` is machine-written and never hand-edited — it lives under `.claudinite/local/` because that is the repo-owned area the vendoring refresh never touches. The worker also declares its `merge=ours` `.gitattributes` entry, so a conflicting merge resolves by re-running the fold rather than by hand.

## Failure is visible, never silent

A fold outage longer than about `retention_days - 1` days loses the raw backing for the unfolded days. That loss is **declared**: each week row records how many days it absorbed, so a week reading `days: 5` states its own hole rather than quietly reporting a smaller number as if it were complete.
