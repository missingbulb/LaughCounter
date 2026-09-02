// THE UPDATE RUNNER (#768) — the shell that makes the versioned flows actually run
// against a member. Everything it decides was decided elsewhere: the flows judge and
// write, `terminalFor` says what happens to the PR, `deliveryFor` says whether the PR
// this run opens is the member's to land. What lives here is the I/O none of them may
// carry — the clone, the branch, the commit, the push, the PR, and the hand-off.
//
// SAME SHAPE AS BASELINING, deliberately. That worker is the proven pattern for
// "converge a member from its own Actions run": clone canon fresh, run the CLONE's
// scripts as subprocesses rather than the mount's stale copies, deliver on a branch,
// and let the shared landing helper own every nuance of arming versus merging. A
// second, cleverer shape here would be a second set of the same bugs.
//
// IT NO LONGER ASKS WHICH MECHANISM SERVES THE REPO. There is one, and its only
// rival was deleted in #768 Phase 5, so the question had exactly one answer for
// every member that could ask it; the `maintenance` block that held it is gone
// (#1252) and `engine/served-by.mjs` is deprecated with it.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { removeTree } from '../../../../engine/remove-tree.mjs';
import {
  deliveryFor, pullCreateError, landDelivery, openDeliveredPull, disposeOpenPull, withTaskTrailer,
} from '../../../claudinite-tasks/shared-code/delivery.mjs';
import { settingsPath, SETTINGS_FILE } from '../../../../engine/settings-file.mjs';

const CANON_URL = 'https://github.com/missingbulb/Claudinite.git'; // public — no token
const UPDATE_PREFIX = 'claudinite/update';
// What this worker stamps on everything it commits and merges (task-trailer.mjs).
const UPDATE_TASK_ID = 'claudinite-lifecycle/update';
const API = 'https://api.github.com';

const git = (args, opts = {}) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });

async function gh(token, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, json };
}

// --- pure helpers (exported, unit-tested git-free) --------------------------

// One branch per run, dated and seeded like baselining's: two runs on one day must
// not collide, and a name that carries its date is one a human can read a week later.
export const updateBranchName = (day, seed) => `${UPDATE_PREFIX}-${day}-${seed}`;

// The line the LIVE CANARY rehearsal greps for. A rehearsal that converges nothing
// and exits 0 is worse than no gate at all — it reports a qualification that never
// happened — and that is not hypothetical: this exact gate went vacuous the day the
// canary flipped to `updates`, because the workflow drove the canary's baselining
// worker, which correctly stood down and exited 0 in zero seconds for weeks.
//
// So the rehearsal announces that it really ran, and the workflow fails when this
// line is absent. Any future path that skips the converge is caught by construction
// rather than by someone noticing a suspiciously fast green.
export const REHEARSAL_MARKER = 'claudinite-rehearsal: converged';

// The PR title and body for a terminal. The body is what a human reads when the run
// stopped, so it says WHICH terminal fired and why in its first line — a PR that only
// says "an update ran" makes every reader re-derive the thing the run already knew.
//
// THE TITLE IS A SUMMARY, THE BODY IS THE DETAIL. A title that names every moved pack
// grows with the number a member declares, and a PR list is where that is least
// readable — so the packs collapse to a count and only the engine keeps its versions.
export function updatePullText(terminal, { engine, packs }) {
  const engineMoved = engine?.from !== engine?.to;
  const movedPacks = (packs?.plan ?? []).filter((p) => p.from !== p.to);
  const moved = [
    ...(engineMoved ? [`engine ${engine?.from ?? 'unstamped'} → ${engine?.to}`] : []),
    ...movedPacks.map((p) => `${p.id} ${p.from ?? 'unstamped'} → ${p.to}`),
  ];
  const summary = [
    ...(engineMoved ? [`engine ${engine?.from == null ? 'unstamped' : `v${engine.from}`} → v${engine?.to}`] : []),
    ...(movedPacks.length ? [`${movedPacks.length} pack${movedPacks.length === 1 ? '' : 's'} upgraded`] : []),
  ];
  const title = summary.length ? `Claudinite update: ${summary.join(' and ')}` : 'Claudinite update';
  const lines = [`**${terminal.action}** — ${terminal.why}`, ''];
  if (moved.length) lines.push('Versions moved by this run:', ...moved.map((m) => `- ${m}`), '');
  else lines.push('No version moved; this run converged the mount and changed nothing else.', '');
  if (terminal.action === 'needs-human') {
    lines.push('This PR stays open. Nothing merges on a non-green terminal — see the label.');
  } else if (terminal.action === 'apply-stage') {
    lines.push('The deterministic half is done. The agent stage applies the new rules to this repo\'s own content before anything merges.');
  }
  return { title, body: `${lines.join('\n')}\n` };
}

// --- I/O shell (validated by the live pilot, not unit tests) ----------------

export async function main() {
  const root = process.env.CLAUDINITE_REPO_ROOT || process.cwd();
  const repo = process.env.CLAUDINITE_REPO || process.env.GITHUB_REPOSITORY;
  const base = process.env.CLAUDINITE_DEFAULT_BRANCH || 'main';
  const token = process.env.GITHUB_TOKEN;
  const requestFile = process.env.CLAUDINITE_REQUEST_AGENT;
  // REHEARSAL MODE (the live canary): converge this repo against a NAMED canon ref,
  // report, and restore the working tree — no branch, no commit, no PR, and above
  // all no stamp. A stamped branch head would leave the canary pointing off trunk,
  // which is exactly what the next converge's anti-rewind guard refuses: a rehearsal
  // that wedges its own canary.
  const rehearsalRef = process.env.CLAUDINITE_CANON_REF || null;
  if (!repo) { console.error('update: no repo (CLAUDINITE_REPO/GITHUB_REPOSITORY)'); process.exit(1); }
  if (!token) { console.error('update: no GITHUB_TOKEN in env'); process.exit(1); }

  // Either settings-file name, in the rename's read order: this worker is VENDORED,
  // so the copy running on a member may predate the record that renamed its own
  // file — and one that only knew the new name would report "nothing to update" on
  // every repo still carrying the old one.
  const settingsFile = settingsPath(root);
  if (!existsSync(settingsFile)) { console.log(`update: no ${SETTINGS_FILE} — nothing to update`); return; }
  const declaration = JSON.parse(readFileSync(settingsFile, 'utf8'));

  // One override, one direction: a repo that asked for review gets its PR opened and
  // left; every other repo — the normal shape, the key absent — has it landed.
  const delivery = deliveryFor(declaration);

  // DISPOSE OF THE INCUMBENT FIRST (#787). A cycle that could not land its PR — the
  // usual cause is a `pull_request` run parked at `action_required` while the
  // dispatched one goes green seconds after the wait gave up — leaves it open for
  // "the next run to dispose of". This is that disposal, and it must happen BEFORE
  // the converge for the reason the bug existed: a cycle that finds nothing to do
  // returns early, so disposal placed after the converge is unreachable on exactly
  // the quiet cycle that should perform it. A cycle that cannot clear the way does
  // not deliver on top of it — one update PR is alive at a time, or none.
  const open = rehearsalRef ? { json: [] } : await gh(token, `/repos/${repo}/pulls?state=open&per_page=100`);
  const incumbent = openDeliveredPull(open.json, UPDATE_PREFIX);
  if (incumbent) {
    const disposal = await disposeOpenPull({
      task: UPDATE_TASK_ID,
      token, repo, pr: incumbent, delivery, log: (s) => console.log(`update: ${s}`),
    }).catch((e) => { console.log(`update: disposing of PR #${incumbent.number} failed: ${e.message}`); return 'kept'; });
    if (disposal === 'kept') {
      console.log(`update: PR #${incumbent.number} still stands — this cycle cannot deliver on top of it`);
      return;
    }
    if (disposal === 'merged') {
      console.log(`update: landed PR #${incumbent.number}; main has moved past this checkout — next cycle converges from it`);
      return;
    }
  }

  // The flows run from a FRESH CANON CLONE, never from this repo's mount: the mount is
  // the thing being replaced, and a flow executing its own stale copy is how a broken
  // update makes itself permanent.
  const tmp = mkdtempSync(join(tmpdir(), 'claudinite-canon-'));
  try {
    // A rehearsal names the ref it is qualifying; an ordinary cycle takes the
    // default branch, which is the only thing a member should ever converge onto.
    git(rehearsalRef
      ? ['clone', '--depth', '1', '--branch', rehearsalRef, CANON_URL, tmp]
      : ['clone', '--depth', '1', CANON_URL, tmp]);
    const load = async (rel) => import(pathToFileURL(join(tmp, rel)).href);
    const { engineUpdate } = await load('packs/claudinite-lifecycle/updates/engine-update.mjs');
    const { packUpdate } = await load('packs/claudinite-lifecycle/updates/pack-update.mjs');
    const { terminalFor } = await load('packs/claudinite-lifecycle/updates/terminals.mjs');

    // ENGINE FIRST, always: a pack declares the minimum engine it runs on, and the
    // pack flow enforces that against what this repo HAS. Running packs first would
    // check every pack against yesterday's engine and block updates that the very
    // next step would have made legal.
    const engine = await engineUpdate(root, { fullName: repo, delivery, selfTestRun: undefined });
    console.log(`update: engine — ${engine.status}: ${engine.detail}`);
    let packs = null;
    if (engine.status !== 'needs-human') {
      packs = await packUpdate(root, { fullName: repo, delivery, selfTestRun: undefined });
      console.log(`update: packs — ${packs.status}: ${packs.detail}`);
    }

    // The engine's terminal wins when it stopped the run: nothing downstream of a
    // refused engine update is trustworthy, including a pack flow that never ran.
    const outcome = engine.status === 'needs-human' ? engine : packs;
    const terminal = terminalFor(outcome);

    // A REHEARSAL STOPS HERE. It has the only answer it was asked for — does this
    // canon ref converge this member and leave it green — so it says so and puts the
    // tree back exactly as it found it. Restoring is not tidiness: an uncommitted
    // converge left behind would be picked up by the canary's own next cycle as if a
    // human had written it.
    if (rehearsalRef) {
      git(['-C', root, 'checkout', '--', '.']);
      git(['-C', root, 'clean', '-fd']);
      if (terminal.action === 'needs-human') {
        console.error(`update: rehearsing ${rehearsalRef} FAILED — ${terminal.why}`);
        process.exit(1);
      }
      console.log(`${REHEARSAL_MARKER} ${repo} against ${rehearsalRef} — ${terminal.action}: ${terminal.why}`);
      return;
    }

    // AN APPLY STAGE IS NOT "NOTHING CHANGED" (#1545). A run that withheld a workflow
    // file leaves the pack unstamped, precisely so the record stays in range — so on a
    // cycle that re-stages content the branch already carries, the tree can be clean
    // while a delivery is still owed. Returning here would skip the PR, and the
    // apply-stage request is written below it, so nobody would ever be asked to deliver:
    // the silent loss this whole fix exists to end, one step further along. The empty
    // commit is the point — the apply stage's own move is what fills the PR.
    const changed = git(['-C', root, 'status', '--porcelain']).trim();
    if (!changed && terminal.action !== 'needs-human' && terminal.action !== 'apply-stage') {
      console.log('update: nothing changed — no branch, no PR');
      return;
    }

    const day = new Date().toISOString().slice(0, 10);
    const seed = Math.random().toString(36).slice(2, 8);
    const branch = updateBranchName(day, seed);
    git(['-C', root, 'checkout', '-B', branch]);
    git(['-C', root, 'add', '-A']);
    const staged = git(['-C', root, 'diff', '--cached', '--name-only']).split('\n').filter(Boolean);
    const { title, body } = updatePullText(terminal, { engine, packs });
    git(['-C', root, '-c', 'user.name=claudinite[bot]', '-c', 'user.email=claudinite@users.noreply.github.com',
      // The trailer is what classifies this converge as machinery to every
      // movement-gated task: the mount refreshing is not the project moving.
      'commit', ...(staged.length ? [] : ['--allow-empty']), '-m', withTaskTrailer(title, UPDATE_TASK_ID)]);
    git(['-C', root, 'push', '--force', `https://x-access-token:${token}@github.com/${repo}.git`, `HEAD:refs/heads/${branch}`]);

    const created = await gh(token, `/repos/${repo}/pulls`, { method: 'POST', body: { head: branch, base, title, body } });
    const failure = pullCreateError(created.status, created.json);
    if (failure) throw new Error(`could not open the update PR for ${branch}: ${failure}`);
    const pr = created.json;
    console.log(`update: opened PR #${pr.number} on ${branch} (${terminal.action})`);

    // The terminal, acted on. Only one action merges, and it is the one the flow
    // already judged green — everything else leaves the PR standing, labelled or
    // handed to the agent stage.
    if (terminal.action === 'merge') {
      await landDelivery({ token, repo, base, pr, delivery, task: UPDATE_TASK_ID });
    } else if (terminal.action === 'needs-human') {
      await gh(token, `/repos/${repo}/issues/${pr.number}/labels`, { method: 'POST', body: { labels: [terminal.label] } });
      console.error(`update: left PR #${pr.number} open and labelled ${terminal.label} — ${terminal.why}`);
      // NON-ZERO, so the work item lands in `needs-human` rather than closing
      // `task:done`. This terminal means the converge DID NOT DELIVER — the PR
      // is parked awaiting a person — and a run that delivered nothing must not
      // report success. Exiting 0 here is what hid #939 for five days: every
      // member's nightly update closed `task:done` while its PR sat parked, so
      // the whole fleet was frozen and every signal said healthy. This is the
      // "reserve non-zero for genuine breakage" rule's genuine breakage: the
      // member is not converging and nothing else will say so.
      process.exitCode = 1;
    } else if (terminal.action === 'apply-stage' && requestFile) {
      writeFileSync(requestFile, `${JSON.stringify({
        marker: 'agent-requested',
        delivered: { branch, pr: pr.number, merged: false },
        reason: { code: 'apply-stage', detail: terminal.why },
      })}\n`);
      console.log(`update: requested the apply stage — ${terminal.why}`);
    }
  } finally {
    removeTree(tmp);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`update failed: ${e.message}`); process.exit(1); });
}
