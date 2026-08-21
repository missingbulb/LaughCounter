# Usage fold — the repo's own past-data plane

**This task runs no agent.** It is `agent_model: none` with `code-work: node worker.mjs`, so the whole pass is the deterministic [`worker.mjs`](worker.mjs) the executor runs as code-work, which calls its sibling in this folder, the counting and folding core ([`fold-usage.mjs`](fold-usage.mjs)). This file is the human-facing record of what that worker does; there is no agent phase.

## What it does

Hourly, when the repo moved: fetch this repo's orphan `conversation-logs` branch and count each capture file still inside the retention window; list the scheduler's and the executor's completed workflow runs since the last fold; list the work items that closed since the last fold; read the local git history and the releases listing; and regenerate `.claudinite/local/usage.GENERATED.json` on a PR that lands itself where this repo's delivery settings allow (the shared landing helper, `engine/scheduler/land-pr.mjs`, owns those nuances — a `review` repo's PR waits for the owner). A recompute that differs only in its `generated` stamp opens nothing, and a repo with no logs branch yet still folds every other source.

### Why hourly, and what stops it being hourly noise

This file is the **past-data plane the dashboard renders from** ([claudinite-dashboard](../../../claudinite-dashboard/README.md)): every panel reaching further back than one page of live reads comes from here, so the file's freshness *is* the page's. The cadence is affordable because the sources are — the capture files are local git, and the REST side is four calls, all watermarked.

What keeps a quiet repo quiet is the **precondition**, which runs the fold only when something moved in the hour: a commit on the default branch, or a conversation log stamped inside the window. It is deliberately *not* gated on the scheduler having run, since the scheduler runs every hour by definition and that would be no gate at all. Declining loses nothing — the run and queue reads sit past their watermarks until the next fold that does have something to do, and the dashboard tops up the freshest hours from the live run listing it already fetches.

What it counts, per bucket:

- **`skillLoads`**, per skill name — `Skill` tool-use entries, plus user-typed `/command`s naming a skill this repo mounts (built-in CLI commands never match). Subagent streams included: a subagent loading a skill is a load.
- **`captures`** — capture events folded. **`merges`** — the subset with an issue behind them (issue `0` means none).
- **`sessions`** — distinct session ids; one session can capture more than once.
- **`userMessages`** — genuine human turns. **`userCommands`** — every typed `/command`.
- **`ruleTokens`** and **`ruleTokenSessions`** — how many rule tokens the mount put into each session's prompt before its first turn, read off the session-start summary line the mount itself prints, and how many sessions attested one. Absent from a session whose mount printed no line; `0` on a day whose captures all lacked it.
- **`tokensIn`** / **`tokensOut`** / **`tokenSessions`** — what the sessions spent, from the usage records the transcript's own assistant entries carry. **Probed, never assumed**: a transcript shape that records no usage leaves the day with no token keys at all, which is what makes "this shape does not record it" distinguishable from "it was free". Cache reads and writes count as input, because that is what the turn was billed for.
- **`commits`** / **`linesAdded`** / **`linesRemoved`** — what landed on the base branch, from local git. A shallow checkout is the normal case in Actions, so days before the history starts carry **no key** rather than a zero.
- **`releases`** — releases published, from one listing read.
- **`checks`**, per scope (`work` / `world`) — `runs` (observed activations), `failures` (runs that reported a blocking finding), `errors` (the runner could not launch), the `blocking`/`advisory` finding volume, and `ciRuns`/`ciFailures` (the CI subset of the first two). **`checkFindings`**, per rule id — which rule caught what.

- **`queue`**, per `pack/task` — what each occurrence came to: closed work items counted under their outcome word (`done`, `delivered`, `obsolete`, `none`). The queue-era successor to the `tasks` rows below (#994) — see "What each occurrence came to".
- **`tasks`**, per `pack/task` — **historical only.** These rows counted what the retired slot scheduler did with each due task (`agent`, `code_work`, `skipped`, `failed`, `deferred`). Nothing writes that record any more, so these rows stop growing as the last slot-era logs age out of Actions retention. The reader stays because the logs inside that window are still real; see "The task invocations are a census" below for what replaces it and what does not.
- **`taskExec`**, per `pack/task` — what the **agent session** did with the item it was handed, distilled from the captured conversation logs: `success`, `failed`, `task-gone` (the item named a task the repo no longer carries), `invalid`. Counted off the machine-readable `claudinite-task-exec` records the session prints (`record-exec.mjs`; format owned by `engine/scheduler/run-record.mjs`), deduped on the full record tuple per capture file — never scraped from the agent's prose. A sample, of the sessions that captured.

The denominators are the point. A raw load count cannot tell healthy-rare from broken — a version-bump skill loading rarely is fine — so the question is loads *against the sessions where that skill's own declared trigger plausibly applied.*

## The check failures are the win

A skill load is evidence that guidance was *reached for*. A **check failure is evidence that it worked**: the finding goes back into the session through the Stop hook and the agent corrects before the work leaves the branch. So the failure counts are not a defect metric to drive down — they are the closest thing this pipeline has to a measure of what the corpus is worth, and `checkFindings` says which rule earned it.

Neither runner writes a metrics file, so both are counted off the marks they already leave in the transcript, each read by one tested function against a fixture copied from a real capture:

- **the Stop hook's `hooklog` line** (`… Stop: done exit=<n> <reason>`), which reaches the transcript via hook stderr — the only mark a *passing* run leaves, and therefore the only reason work-scope **runs** are countable and not just failures. Its reason also carries the two outcomes nothing else reveals: a `loop-guard-relent` (blocking findings that survived two fix attempts, printed as a message rather than a findings block) and a `runner-error` (the checks did not run at all — enforcement silently off, which is why it gets its own counter instead of hiding inside a clean day);
- **`report-findings`' summary line** (`N blocking, M advisory (<scope> scope: …)`), which names its own scope and survives the `| tail` an agent usually pipes a run through — printed only when there *were* findings, so it counts failures, never runs;
- **the runner's invocation in a Bash command** (`node …/check_the_world.mjs`), which is how the world scope runs at all — it is wired into the test/CI flow, not the Stop hook.

Runs come only from the marks a passing run also leaves; where a runner ran without its command naming it (a `make test` wrapping it), the summary lines are the floor, so the count is the **max** of the two signals rather than their sum. Only Bash and CI-log tool results are read, paired back to the tool that produced them — in the corpus that owns the runners, reading a file that merely *mentions* this vocabulary is the ordinary case.

### CI counts when the agent was in the loop on it

Write, commit, let CI run, fix what it caught is the same correction loop as the Stop hook's, one turn wider — so a CI check failure the session acted on is the same kind of win. It counts exactly when the session **pulled the job log in**, which is what "the agent was in the loop" means operationally. A nightly or post-merge run nobody looked at stays uncounted, correctly: nothing was corrected.

Two consequences, both mechanism rather than policy. Actions stamps every log line with its own timestamp before the command's output, so each mark tolerates that prefix — without it a fetched CI log reads as having printed nothing at all. And a job log gets fetched repeatedly while iterating on the failure, with nothing in a fetch saying *which run* it was, so CI texts dedupe on the check output itself: two fetches of one job collapse, two real runs differ by their timestamps.

**Every check number is a floor.** A run whose CI log nobody fetched left no mark in any session transcript; neither did a hook killed before it logged; and a green CI sweep prints nothing to be seen by, which is why the CI share is carried separately as `ciRuns`/`ciFailures` instead of quietly skewing a rate. The under-count is one-directional by construction, which is what keeps "the checks caught N things this week" a claim worth making.

## What each occurrence came to

Everything counted off the capture files is read out of *sessions*, so it sees only what was captured. A whole half of what this repo does opens no session at all — a precondition that finds nothing to do, an agentless task whose whole work is its code-work, an item that yielded to another. None of that leaves a transcript, and the first of them is the most common thing scheduling does.

The `tasks` rows used to answer that from the other side: the slot scheduler printed one line per due task into its own Actions log (`claudinite-task-run v1 <pack>/<task> [<slot>] <outcome>`). **That writer retired with the slot scheduler** (#974), so those rows are history — exact within the window they covered, ending where the slot scheduler did, not comparable to a period after it. The reader that fetched them retired with them too, rather than spending two API calls per run to find records nothing writes; the day rows now only age out, and the week rows that froze them keep them.

What replaced it is the **`queue`** rows (#994), and they are a better record: every occurrence *is* a work item, and a converged one closes wearing an `outcome:*` label. That survives Actions retention, it is clickable, and it names its own task. [`read-queue.mjs`](read-queue.mjs) reads the items that closed since the last fold and counts them per task per outcome.

Two families here are **appended once rather than recomputed**, each past its own watermark:

- the **hour rows'** run counts, past `runsFoldedThrough` ([`read-runs.mjs`](read-runs.mjs));
- the **`queue`** rows, past `queueFoldedThrough` ([`read-queue.mjs`](read-queue.mjs)).

The reason is the source, not taste: the capture files are a local git branch this fold re-reads for free, while both of these are rate-limited REST listings, and re-reading a month of them every hour would cost orders of magnitude more calls for the same answer. Appending is safe because both are settled once seen — a completed run's conclusion does not change, and a closed item's outcome label is written at convergence and never moved. The queue read is bounded on `closed_at` rather than `updated_at` for exactly that reason: the listing is asked for everything *touched* since the mark (a comment counts as a touch), and only items that closed past it are counted, so nothing is ever counted twice.

The price is stated rather than hidden: a counting bug fixed later applies from the fix forward and does not heal these rows.

## Three tiers, three different mechanisms

- **Hours** cover the last three days, and are the tier the dashboard's live panels read. Their run counts are appended past the run watermark; their session counts are recomputed from the capture files every fold. The two are kept in separate *fields* rather than merged, because merging them would make the recompute silently double the appended total.
- **Days** are recomputed **from scratch, every run**, from the live capture files. No ingest ledger, no double-count risk, and a counting-bug fix self-heals the whole visible window on its next run. A day row drops out when its raw files age past retention — its content lives on in its week row.
- **Weeks** are appended **once**, past a single `foldedThrough` watermark: every day that has closed since the mark is added to its ISO week and the mark advances. Days close strictly in order, so a monotone mark is the entire exactly-once mechanism.

Week rows are frozen by that trade: a counting bug found later heals the day window automatically, but weeks folded under the old counting keep it — re-freezing would need raw data the retention TTL deliberately destroyed. Git history records which commit folded what. A *new* counter meets the same trade from the other end: weeks folded before the check counts existed carry no `checks` key, and the fold grows them from the day they close forward rather than refusing to advance the watermark past them — a partial series beats a wedged one.

## The file is GENERATED

`.claudinite/local/usage.GENERATED.json` is machine-written and never hand-edited — it lives under `.claudinite/local/` because that is the repo-owned area the vendoring refresh never touches. The worker also declares its `merge=ours` `.gitattributes` entry, so a conflicting merge resolves by re-running the fold rather than by hand.

## Failure is visible, never silent

A fold outage longer than about `retention_days - 1` days loses the raw backing for the unfolded days. That loss is **declared**: each week row records how many days it absorbed, so a week reading `days: 5` states its own hole rather than quietly reporting a smaller number as if it were complete.

Every source is **independently** fail-soft, and each says so in the run log: one that cannot be read costs its own rows this fold and leaves its own watermark where it was, so the next fold retries exactly what it missed. None of them can take the capture-derived counts down with it.

And the same rule runs through every field: **an absent source leaves no key, never a zero.** A day before a shallow checkout's history starts has no commit or line counts; a day whose transcripts carried no usage records has no token counts; a week that absorbed days of both kinds reports only the days that knew. A reader meeting a missing key is meant to say *not recorded* — which is information — rather than draw a zero, which is a claim.

## The freshness stamp

The file carries `generated`, the time of the fold that last confirmed its numbers. That is **not** the same as when the file last landed: a quiet repo recomputes to the same numbers and opens no PR, so the commit date can be days older. The unchanged-compare deliberately ignores that one line — a stamp that forced a PR every hour would be a stamp nobody could afford.
