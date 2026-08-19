// The adopt-requested-packs prework — the conditional gate in front of the agent
// stage: count THIS repo's open `add-packs` work-list issues and request the agent
// iff any exist. A forced run with an empty work list (a re-fire after the work
// landed, a hand-press on a repo with nothing asked of it) ends here, quietly, with
// no agent phase.
//
// It reads over the ordinary Action GITHUB_TOKEN — the one sanctioned non-MCP
// surface — against this repo's OWN issues; nothing here reaches any other repo.
// What it hands the agent is the ISSUE SURFACE, not a data channel: the work lists
// stay in the issues, and the agent reads them under its own instructions (task.md).
// The request file carries only the condition's name and the issue numbers this run
// found (identifiers, per the prework contract's one named exception).

import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { LABEL } from './protocol.mjs';

const item = process.env.CLAUDINITE_ITEM || '';
const log = (s) => console.log(`adopt-requested-packs${item ? ` [#${item}]` : ''}: ${s}`);

// The one read: this repo's open issues under the protocol label. PRs are filtered
// out — the issues API returns both, and a PR carrying the label is not a work list.
export async function openWorkLists(repo, token) {
  const res = await fetch(`https://api.github.com/repos/${repo}/issues?labels=${LABEL}&state=open&per_page=100`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'claudinite-adopt-requested-packs',
    },
  });
  if (res.status !== 200) throw new Error(`listing ${LABEL} issues on ${repo} returned ${res.status}`);
  const issues = await res.json();
  return (Array.isArray(issues) ? issues : []).filter((i) => !i.pull_request);
}

export async function main() {
  const repo = process.env.GITHUB_REPOSITORY || process.env.CLAUDINITE_REPO;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !repo.includes('/')) throw new Error('GITHUB_REPOSITORY is not set (owner/repo)');
  if (!token) throw new Error('GITHUB_TOKEN is not set — the scheduler always provides it');

  const open = await openWorkLists(repo, token);
  if (!open.length) {
    log(`no open \`${LABEL}\` work list — nothing asked of this repo, no agent needed`);
    return;
  }

  const requestPath = process.env.CLAUDINITE_REQUEST_AGENT;
  if (!requestPath) throw new Error('CLAUDINITE_REQUEST_AGENT is not set — cannot hand off to the agent stage');
  writeFileSync(requestPath, JSON.stringify({
    reason: {
      code: 'add-packs-work-list',
      detail: `${open.length} open \`${LABEL}\` issue(s): ${open.map((i) => `#${i.number}`).join(', ')}`,
    },
  }));
  log(`agent requested — ${open.length} open work list(s): ${open.map((i) => `#${i.number} (${i.title})`).join('; ')}`);
}

// Run only when invoked directly (prework's `node worker.mjs`), never on import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`adopt-requested-packs failed: ${e.message}`); process.exit(1); });
}
