// The signal collectors (per-project-scheduling DESIGN §3.3). Each reads a
// bounded, cheap slice of the repo's GitHub state (or local disk) for one signal
// name; `collectSignals` gathers only the union the PICKED task declared, so an
// hourly task never pays for a daily task's signals. Every collector takes the
// shared `(gh, ctx)` and returns a plain data object a precondition reads.
//
// Pure over the injected `gh` reader and a `ctx` of already-resolved facts, so
// the whole layer tests against a fake `gh` with no live GitHub. The ctx facts a
// collector cannot fetch for itself (manifest version, local-pack presence,
// retention) are read off the checkout by signals/context.mjs — see signals/local.mjs.

import { LOCAL_PACK_ROOTS } from './local.mjs';
import { QUEUED_LABEL } from '../queue/work-item.mjs';
import { APPROVAL_RE } from '../built-in-tasks.mjs';

// A default-branch commit is genuine project work unless it is bot/CI
// housekeeping or one of Claudinite's own automated writes — the same exclusions
// the fleet planner applies (kept in sync), extended with the scheduler's own
// `[claudinite-task]` and `[claudinite-work]` writes so neither dispatch
// mechanism ever self-triggers. The queue's vocabulary is excluded HERE, before
// any repo flips (tasks-dispatch F8): a queue-mode repo's own work items are
// repo activity to every precondition watching issues, so a collector that had
// not learned the new title would wake tasks on the queue's own churn.
const HOUSEKEEPING = /\[skip ci\]|(^|\n)\s*baselin(e|ing)\b|claudinite[ -](baselin|maintenance|growth|task|work)|seed default-on/i;

// …and a THIRD exclusion the message cannot express: a commit that touched
// nothing outside `.claudinite/` moved the repo's own working rules, not the
// project. Every consumer of `substantiveChange` means "genuine project work" by
// it — an issue was implemented (tidy-issues), something shippable changed
// (store-release), there is a lesson to extract (growth-extract) — and none of
// those is true of a corpus edit. Message and author cannot catch it: a human
// landing a lesson PR writes an ordinary message under their own login, so the
// growth lifecycle's own landed output re-armed it the next night and a repo
// could never go quiet (TLDR #319).
//
// `files` is `[]` when the commit's detail read failed, which is UNKNOWN, not
// "touched only .claudinite/" — a bare `every` is vacuously true on it and would
// silently retire the trigger for every commit the API would not detail. Require
// at least one known path before the exclusion can apply.
const CORPUS_ONLY = (files) => files.length > 0 && files.every((f) => f.startsWith('.claudinite/'));
const isSubstantive = (c, files) => {
  const login = c.author?.login ?? '';
  if (login.endsWith('[bot]')) return false;
  if (CORPUS_ONLY(files)) return false;
  return !HOUSEKEEPING.test(c.commit?.message ?? '');
};

// The capture stamp a conversation log's filename leads with:
// `2026-07-19T0940Z--issue-123--<session>.jsonl` — minute precision, optionally
// `-<k>` suffixed on a same-minute collision. Anything else on the logs branch
// (its README) is not a log and has no age. The writer of that name is the
// capture step in the pack that owns the branch, which core deliberately does not
// import (engine/ depends on no pack, per the barrier); the drift guard in
// engine-tests/scheduler/signals.test.mjs pins this parse to that writer, so
// changing one without the other fails loudly rather than silently retiring the
// prune trigger.
const LOG_STAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})Z(?:-\d+)?--issue-\d+--.+\.jsonl$/;
function logStampMs(name) {
  const m = LOG_STAMP.exec(name);
  if (!m) return null;
  const ms = Date.parse(`${m[1]}T${m[2]}:${m[3]}:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

async function paged(gh, path) {
  const out = [];
  for (let page = 1; ; page += 1) {
    const sep = path.includes('?') ? '&' : '?';
    const { status, json } = await gh(`${path}${sep}per_page=100&page=${page}`);
    if (status !== 200 || !Array.isArray(json) || json.length === 0) break;
    out.push(...json);
    if (json.length < 100) break;
  }
  return out;
}

// Like `paged`, but for a listing sorted `updated` DESCENDING and bounded by the
// window: it stops at the first item outside it and does not fetch the next page.
// The closed-PR listing is otherwise the repo's whole history — a window read must
// not cost proportionally to that.
async function pagedWindow(gh, path, inWindow) {
  const out = [];
  for (let page = 1; ; page += 1) {
    const sep = path.includes('?') ? '&' : '?';
    const { status, json } = await gh(`${path}${sep}per_page=100&page=${page}`);
    if (status !== 200 || !Array.isArray(json) || json.length === 0) break;
    const kept = [];
    for (const item of json) {
      if (!inWindow(item)) break;
      kept.push(item);
    }
    out.push(...kept);
    if (kept.length < json.length || json.length < 100) break;
  }
  return out;
}

// A merged PR is mineable unless it is bot work or one of Claudinite's own
// automated writes — the same author/message exclusions `isSubstantive` and the
// `issues` collector apply, kept together on purpose. It does NOT carry the
// corpus-only exclusion: the PR listing has no file list, and resolving one per
// PR would cost a read per PR across the whole window. It does not need to —
// a corpus-only PR's merge commit is already non-substantive, so no task with a
// `commits`-gated precondition ever reaches this listing on its account. The housekeeping regex already covers
// the growth tasks' own `Claudinite growth: …` PRs and the scheduler's
// `[claudinite-task]` titles, so the self-trigger guards survive the widening.
const isMinablePr = (p) => {
  if ((p.user?.login ?? '').endsWith('[bot]')) return false;
  return !HOUSEKEEPING.test((p.title ?? '').trim());
};

// Commit objects in the window, with their changed-file lists resolved (one read
// per commit — the window is a handful of commits).
async function windowCommits(gh, repo, branch, sinceIso) {
  const list = await paged(gh, `/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&since=${sinceIso}`);
  const detailed = [];
  for (const c of list) {
    const d = await gh(`/repos/${repo}/commits/${c.sha}`);
    const files = d.status === 200 ? (d.json?.files ?? []).map((f) => f.filename).filter(Boolean) : [];
    detailed.push({ sha: c.sha, message: c.commit?.message ?? '', author: c.author?.login ?? null, substantive: isSubstantive(c, files), files });
  }
  return detailed;
}

const COLLECTORS = {
  async commits(gh, ctx) {
    const commits = await windowCommits(gh, ctx.repo, ctx.defaultBranch, ctx.sinceIso);
    return {
      list: commits,
      count: commits.length,
      substantiveChange: commits.some((c) => c.substantive),
      touchedPaths: [...new Set(commits.flatMap((c) => c.files))],
    };
  },

  async prs(gh, ctx) {
    const open = await paged(gh, `/repos/${ctx.repo}/pulls?state=open&sort=updated&direction=desc`);
    const since = new Date(ctx.sinceIso);

    // PRs MERGED during the window, in a field of their OWN. A merged PR carries
    // the review discussion and the "what changed and why" — usually the richest
    // lesson material in a window — and `state=open` alone made it unreachable to
    // any task bound to this signal. It is deliberately NOT folded into `open` or
    // `touched`: those two are other tasks' target sets (the PR tidy sweep acts on
    // `open`), and widening them here would silently widen what those tasks do.
    // The same exclusions the `commits` and `issues` collectors apply hold here, so
    // a growth task still cannot see its own merged output and re-trigger on it.
    const closed = await pagedWindow(
      gh,
      `/repos/${ctx.repo}/pulls?state=closed&sort=updated&direction=desc`,
      (p) => new Date(p.updated_at) >= since,
    );
    const merged = closed
      .filter((p) => p.merged_at && new Date(p.merged_at) >= since && isMinablePr(p))
      .map((p) => ({ number: p.number, title: p.title, mergedAt: p.merged_at }));

    return {
      // `labels` rides along so a precondition can rule on an open PR's family
      // (e.g. wiki-growth declining while its own labeled PR sits unreviewed) —
      // the run/no-run decision belongs in the precondition, and it can only
      // live there if the signal carries the fact it turns on.
      open: open.map((p) => ({
        number: p.number, title: p.title, updatedAt: p.updated_at,
        labels: (p.labels ?? []).map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean),
      })),
      touched: open.filter((p) => new Date(p.updated_at) >= since).map((p) => p.number),
      merged,
    };
  },

  async issues(gh, ctx) {
    const open = await paged(gh, `/repos/${ctx.repo}/issues?state=open&sort=updated&direction=desc`);
    const since = new Date(ctx.sinceIso);
    // Exclude PRs (the issues endpoint returns both) and the scheduler's own
    // work items / standing trackers — invisible to signals (DESIGN §3.3).
    const real = open.filter((i) => !i.pull_request
      && !/^\[claudinite-(task|work)\]/.test(i.title ?? '')
      && !/^(claudinite tracker:|auto-improvements tracker\b|repo tidy tracker$)/i.test((i.title ?? '').trim()));
    return {
      open: real.map((i) => ({ number: i.number, title: i.title, updatedAt: i.updated_at, labels: (i.labels ?? []).map((l) => l.name ?? l) })),
      touched: real.filter((i) => new Date(i.updated_at) >= since).map((i) => i.number),
    };
  },

  // Every open branch, each with the date of its tip commit — so a precondition
  // can tell a branch that MOVED in the window from the standing pile that did
  // not. `touched` is the same field name, with the same meaning, the `prs` and
  // `issues` collectors carry; without it the branch dimension had no notion of
  // newness at all and every gate over it degenerated to "a branch exists".
  //
  // The tip date costs one commit read per DISTINCT tip sha (branches sharing a
  // tip share the read) because the branch listing carries no date of its own —
  // no REST listing does. That is the price of the only newness this dimension
  // can observe, and it is paid on a weekly clock over a handful of branches.
  // A tip read that fails leaves `updatedAt: null`, which is NOT touched: no
  // proof of movement never wakes an agent.
  async branches(gh, ctx) {
    const list = await paged(gh, `/repos/${ctx.repo}/branches`);
    const since = new Date(ctx.sinceIso);

    const dateBySha = new Map();
    for (const sha of new Set(list.map((b) => b.commit?.sha).filter(Boolean))) {
      const { status, json } = await gh(`/repos/${ctx.repo}/commits/${sha}`);
      const c = status === 200 ? json?.commit : null;
      dateBySha.set(sha, c?.committer?.date ?? c?.author?.date ?? null);
    }

    const entries = list.map((b) => ({ name: b.name, updatedAt: dateBySha.get(b.commit?.sha) ?? null }));
    return {
      names: entries.map((e) => e.name),
      list: entries,
      touched: entries.filter((e) => e.updatedAt && new Date(e.updatedAt) >= since).map((e) => e.name),
    };
  },

  async release(gh, ctx) {
    const { status, json } = await gh(`/repos/${ctx.repo}/releases/latest`);
    const latestTag = status === 200 ? (json?.tag_name ?? null) : null; // 404 → no release yet
    return { latestTag, manifestVersion: ctx.manifestVersion ?? null, shipsPipeline: ctx.shipsReleasePipeline ?? null };
  },

  // Whether the repo carries local packs, and whether a window commit touched
  // one (under either local root during the rename window).
  async localPacks(gh, ctx) {
    const commits = ctx.commits ?? await windowCommits(gh, ctx.repo, ctx.defaultBranch, ctx.sinceIso);
    const touches = (f) => LOCAL_PACK_ROOTS.some((r) => f.startsWith(r));
    const present = ctx.hasLocalPacks ?? null;
    return { present, changedInWindow: commits.some((c) => c.files.some(touches)) };
  },

  // Which DECLARED packs' vendored files changed in the window — the local echo
  // of "canon changed" (replaces the cross-repo relevantCanonChanged).
  async sharedMount(gh, ctx) {
    const commits = ctx.commits ?? await windowCommits(gh, ctx.repo, ctx.defaultBranch, ctx.sinceIso);
    const declared = new Set(ctx.activePacks ?? []);
    const changed = new Set();
    for (const c of commits) {
      for (const f of c.files) {
        const m = /^\.claudinite\/shared\/packs\/([^/]+)\//.exec(f);
        if (m && declared.has(m[1])) changed.add(m[1]);
      }
    }
    return { changedPacks: [...changed] };
  },

  // The conversation-logs orphan branch: present, and the age of its oldest JSONL
  // vs the configured retention (the age-based prune's trigger on quiet repos).
  //
  // Age comes from the FILENAME stamp, not from git/commit metadata. Commit dates
  // are the authoritative record of when a blob landed, but they are the wrong
  // authority here and cost more: (a) AGREEMENT — the consuming task's prune rule
  // is itself stated over the filename stamp ("each log whose filename stamp is
  // older than retention"), so a commit-date trigger would dispatch an agent over
  // logs the worker then declines to prune, and stay silent on ones it would
  // prune; (b) COST — one tree
  // read covers the whole branch, against one commit-history read per file, and
  // the branch accumulates one log per merged session. The name is machine-written
  // by the pack's capture step, never user input, so "trusting the name" is
  // trusting our own writer — and a drift guard pins the two formats together.
  async conversationLogs(gh, ctx) {
    const retentionDays = ctx.retentionDays ?? null;
    const branch = await gh(`/repos/${ctx.repo}/branches/conversation-logs`);
    if (branch.status !== 200) return { present: false, retentionDays, oldestLogAgeDays: null, logCount: 0 };

    // Logs sit flat at the branch root beside its README; a non-200 tree read (or
    // anything unparsable on it) is "no age to judge", never a failed collection.
    const { status, json } = await gh(`/repos/${ctx.repo}/git/trees/conversation-logs`);
    const stamps = (status === 200 && Array.isArray(json?.tree) ? json.tree : [])
      .map((e) => logStampMs(e?.path ?? ''))
      .filter((ms) => ms !== null);
    const now = new Date(ctx.now).getTime();
    const oldestLogAgeDays = stamps.length && Number.isFinite(now)
      ? (now - Math.min(...stamps)) / 86400000
      : null;
    return { present: true, retentionDays, oldestLogAgeDays, logCount: stamps.length };
  },

  // The vendored-mount provenance stamp and its age; the canon head sha when the
  // Action was given one (the update task's precondition falls back to stamp age).
  async stamp(gh, ctx) {
    const stamp = ctx.config?.claudinite ?? null;
    let ageDays = null;
    if (stamp?.updated) {
      const ms = new Date(ctx.now).getTime() - new Date(stamp.updated).getTime();
      if (Number.isFinite(ms)) ageDays = ms / 86400000;
    }
    return { updated: stamp?.updated ?? null, ref: stamp?.ref ?? null, ageDays, canonHead: ctx.canonHead ?? null };
  },

  // Fleet aggregate — canon-only, over the fleet PAT (DESIGN §3.3). A consumer
  // cannot declare it; the collector returns null unless the caller supplied a
  // fleet reader (wired on the canon and fleet-enforcer repos in Phase 2).
  // THE REQUEST READ (tasks-dispatch DESIGN §16.4). Unlike every collector beside
  // it, this one reads a single named object rather than a window: the issue THIS
  // item was created for, off `ctx.item.request`. That is what the precondition's
  // third argument buys — a verdict about one issue, which no window of repo
  // activity can single out.
  //
  // It reads facts and forms no judgment: who asked, who blessed it with the
  // approval phrase, and what PERMISSION each of them holds — never whether that is
  // enough. The rule lives in the task's precondition, where every other verdict is.
  //
  // Three shapes of answer, and the difference between the last two is the whole of
  // F27: `gone` (the API says it does not exist) is a fact a precondition can
  // decline on, while `unreadable` (a rate limit, a 500) is one it must NOT — a
  // decline's write-back cannot reach an issue it cannot read.
  async request(gh, ctx) {
    const number = ctx.item?.request ?? null;
    if (!number) return null;
    const { status, json } = await gh(`/repos/${ctx.repo}/issues/${number}`);
    if (status === 404 || status === 410) return { number, gone: true };
    if (status !== 200 || !json) return { number, unreadable: true, error: `the issues API answered ${status}` };

    // The permission API is the authority, never the payload's `author_association`:
    // `MEMBER` is any org member whatever their repo permission, and `COLLABORATOR`
    // includes read-only collaborators — both broader than push (F30). A read that
    // fails is unreadable, not "no permission": guessing downward here would refuse
    // a legitimate request over a rate limit.
    const permissions = new Map();
    let failed = null;
    const permissionOf = async (login) => {
      if (!login) return 'none';
      if (permissions.has(login)) return permissions.get(login);
      const res = await gh(`/repos/${ctx.repo}/collaborators/${encodeURIComponent(login)}/permission`);
      // A 403/404 here is a real answer: the caller may not read collaborators, or
      // this login is not one. The first is a repo-configuration fault and the
      // second is the ordinary "a stranger opened it" case, and only the API can
      // tell them apart — so a 404 is `none` and anything else stops the read.
      let value;
      if (res.status === 200) value = res.json?.role_name ?? res.json?.permission ?? 'none';
      else if (res.status === 404) value = 'none';
      else { failed = `the permission API answered ${res.status} for @${login}`; value = 'none'; }
      permissions.set(login, value);
      return value;
    };

    const author = json.user?.login ?? null;
    const authorPermission = await permissionOf(author);
    // The approval phrase is only worth a permission read on the comments that
    // carry it, so an issue with a long thread costs one read per distinct blesser.
    const comments = await paged(gh, `/repos/${ctx.repo}/issues/${number}/comments`);
    const approvals = [];
    for (const c of comments) {
      const login = c.user?.login ?? null;
      if (!login || !APPROVAL_RE.test(c.body ?? '')) continue;
      approvals.push({ login, permission: await permissionOf(login) });
    }
    if (failed) return { number, unreadable: true, error: failed };

    return {
      number,
      state: json.state,
      labels: (json.labels ?? []).map((l) => l.name ?? l),
      queued: (json.labels ?? []).map((l) => l.name ?? l).includes(QUEUED_LABEL),
      author,
      authorPermission,
      approvals,
    };
  },

  async fleet(gh, ctx) {
    return ctx.fleet ?? null;
  },
};

export const SIGNAL_COLLECTORS = Object.keys(COLLECTORS);

// Collect exactly the requested signal names into one object. An unknown name is
// ignored (the task-declaration-shape check rejects those at author time); a
// collector that throws records `{ error }` under its key rather than sinking the
// whole collection (per-signal isolation).
export async function collectSignals(gh, ctx, names) {
  const out = {};
  // Commit-derived collectors share one window read.
  if (names.some((n) => ['commits', 'localPacks', 'sharedMount'].includes(n)) && !ctx.commits) {
    try { ctx = { ...ctx, commits: await windowCommits(gh, ctx.repo, ctx.defaultBranch, ctx.sinceIso) }; } catch { /* collectors re-read on demand */ }
  }
  for (const name of names) {
    const collect = COLLECTORS[name];
    if (!collect) continue;
    try { out[name] = await collect(gh, ctx); }
    catch (e) { out[name] = { error: e.message }; }
  }
  return out;
}
