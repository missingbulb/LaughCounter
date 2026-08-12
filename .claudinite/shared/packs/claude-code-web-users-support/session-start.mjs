// This pack's session-start step: fetch the current user's personal interaction
// preferences from the store this repo points at, and print them into the session
// context. The engine runs it (engine/pack_loader/run-pack-session-start.mjs) because
// this pack ships the file; it knows nothing about what the file does.
//
// WHY THIS IS A STEP AND NOT PROSE. `RULES.md` is fixed at vendor time and identical
// for every repo and every person that mounts it. What this pack contributes is
// neither: it belongs to the person in front of the session, and it lives in another
// repository entirely. Only something that runs at session start can say it.
//
// WHY THE CONTENT IS NOT HERE. Personal preferences belong to a group of people, not
// to a project and not to the shared canon — which every fleet mounts, and which is
// therefore both the wrong host for one group's preferences and the wrong authority
// on where they live. So this pack carries the ADDRESS (its entry `config`, read via
// store.mjs) and the group carries the content.
//
// LOCAL FIRST. When this tree IS the store, the working copy is what the owner is
// reading and editing — a fetch would serve the default branch and quietly hide the
// edit in progress.
//
// FAIL-SOFT ON EVERY MISS. No identity, no configured store, no file, a fetch that
// fails: one plain-text note, and the session proceeds on default interaction
// behavior. Nothing here is load-bearing — the packs, checks and skills a session
// needs are already local — and a halt directive over a nice-to-have would be a
// pack deciding the session cannot start.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveStore, fileFor, isUsableIdentity } from './store.mjs';

const FETCH_TIMEOUT_MS = 15_000;
const FETCH_ATTEMPTS = 3;

const note = (s) => process.stdout.write(`USER PREFERENCES: ${s}\n`);

// How many preferences this person actually has, stated on the engine's facet
// channel (engine/pack_loader/run-pack-session-start.mjs) so the session's opening
// summary can say it. One distilled preference per bullet is the store's rule, so
// the bullets ARE the count — and this step is the only thing in the session that
// can take it, since the file it read lives in another repository.
const facet = (text) => {
  const n = text.split('\n').filter((line) => /^\s*[-*]\s+\S/.test(line)).length;
  if (n) process.stdout.write(`CLAUDINITE-FACET: ${n} personal preference rule${n === 1 ? '' : 's'}\n`);
};

const emit = (s) => { facet(s); process.stdout.write(s.endsWith('\n') ? s : `${s}\n`); process.exit(0); };

// Strip quotes/backslashes before embedding an identity in a message, so an unusual
// one stays tidy in the injected text.
const safe = (s) => String(s).replace(/["\\]/g, '');

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// The engine hands this pack its own entry `config`; nothing here re-reads settings.
let config = {};
try { config = JSON.parse(process.env.CLAUDINITE_PACK_CONFIG || '{}'); } catch { /* malformed — the rule reports it */ }

const store = resolveStore(config);
if (!store) {
  note('this project declares no preferences store (the pack entry\'s "config": { "repo": … }) — proceeding with default interaction behavior.');
  process.exit(0);
}

const email = process.env.CLAUDE_CODE_USER_EMAIL || '';
if (!email) {
  note('CLAUDE_CODE_USER_EMAIL is not set — proceeding with default interaction behavior.');
  process.exit(0);
}
if (!isUsableIdentity(email)) {
  note(`CLAUDE_CODE_USER_EMAIL (${safe(email)}) is not a usable file name — proceeding with default interaction behavior.`);
  process.exit(0);
}

const relative = fileFor(store, email);

// Local first: this tree is the store itself.
const local = join(root, relative);
if (existsSync(local)) {
  try {
    emit(readFileSync(local, 'utf8'));
  } catch (e) {
    note(`${relative} is present but unreadable (${e.message}) — proceeding with default interaction behavior.`);
    process.exit(0);
  }
}

// Otherwise fetch the single file. CLAUDINITE_PREFS_URL overrides the derived base
// for a fork or a test. `HEAD` is the store repo's default branch, whatever it is
// called — the config names a repo, never a branch.
const base = process.env.CLAUDINITE_PREFS_URL
  || `https://raw.githubusercontent.com/${store.repo}/HEAD/${store.path}`;
const url = `${base}/${encodeURIComponent(email)}.md`;

let lastError = 'no response';
for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (res.status === 404) { lastError = 'no preferences file for this user'; break; } // a definite answer — do not retry it
    if (!res.ok) { lastError = `HTTP ${res.status}`; continue; }
    const text = await res.text();
    if (text.trim()) emit(text);
    lastError = 'the file is empty';
    break;
  } catch (e) {
    lastError = e.message || String(e);
  }
}
note(`${safe(email)} at ${store.repo} could not be read (${lastError}) — proceeding with default interaction behavior.`);
process.exit(0);
