// The scheduler's GitHub WRITES — the small set of issue mutations both dispatch
// mechanisms make, over the injected `gh` reader from signals/gh.mjs. Reads live
// with their callers; these are here so the slot machinery and the work-item queue
// share one implementation of each, rather than two that drift.
//
// LABEL WRITES ARE GRANULAR, ALWAYS (tasks-dispatch DESIGN §4, RESEARCH §2): add
// and remove NAMED labels (POST/DELETE), never write the label SET (PUT). A
// set-write replaces from a stale snapshot and clobbers concurrent transitions —
// a bug class GitHub's own CLI shipped (cli/cli#4861) — and with a tick and
// several executors all moving labels at once, that is a correctness rule rather
// than a style preference.

// Ensure every label exists before any is applied. Load-bearing, not cosmetic:
// GitHub does not create a label when you apply one (the issues API 422s on an
// unknown label), so the thing that assigns a label must guarantee it first.
// Idempotent (201 created / 422 already exists are both success) and self-healing
// — a deleted label reappears on the next run.
export async function ensureLabels(gh, repo, labels) {
  for (const { name, color, description } of labels) {
    const res = await gh(`/repos/${repo}/labels`, { method: 'POST', body: { name, color, description } });
    if (res.status === 201) continue;                       // created to spec — nothing further
    if (res.status === 422) {
      // The NAME is taken; that says nothing about the colour or description. A
      // label GitHub auto-created (applying an unknown name to an issue mints it
      // grey `ededed`, no description) would keep those defaults for good, because
      // POST 422s forever. So reconcile the shape, not just the existence — that
      // is what makes the self-healing claim above true for drift and not only for
      // deletion. PATCH is idempotent: an already-correct label is a no-op write.
      const fix = await gh(`/repos/${repo}/labels/${encodeURIComponent(name)}`, {
        method: 'PATCH', body: { color, description },
      });
      if (fix.status !== 200) console.log(`! could not reconcile label "${name}": ${fix.status}`);
      continue;
    }
    console.log(`! could not ensure label "${name}": ${res.status}`);
  }
}

export const addLabel = (gh, repo, number, name) =>
  gh(`/repos/${repo}/issues/${number}/labels`, { method: 'POST', body: { labels: [name] } });

// A label that is already absent 404s; that is the desired end state, so it is
// success. Nothing here reads the response beyond reporting it.
export const removeLabel = (gh, repo, number, name) =>
  gh(`/repos/${repo}/issues/${number}/labels/${encodeURIComponent(name)}`, { method: 'DELETE' });

// The swap every state transition makes. Remove-then-add, and NOT atomic —
// GitHub has no atomic label swap. That is safe because labels are visibility and
// the pick filter, never the arbiter (the claim comments are); what a torn swap
// CAN leave is an open item wearing no state label at all, which the janitor
// repairs (tasks-dispatch DESIGN §6.2, §11).
export async function swapLabel(gh, repo, number, from, to) {
  await removeLabel(gh, repo, number, from);
  return addLabel(gh, repo, number, to);
}

export const comment = (gh, repo, number, body) =>
  gh(`/repos/${repo}/issues/${number}/comments`, { method: 'POST', body: { body } });

export const listComments = async (gh, repo, number) => {
  const out = [];
  for (let page = 1; ; page += 1) {
    const { status, json } = await gh(`/repos/${repo}/issues/${number}/comments?per_page=100&page=${page}`);
    if (status !== 200 || !Array.isArray(json) || json.length === 0) break;
    out.push(...json);
    if (json.length < 100) break;
  }
  return out;
};

export const closeIssue = (gh, repo, number, stateReason = 'completed') =>
  gh(`/repos/${repo}/issues/${number}`, { method: 'PATCH', body: { state: 'closed', state_reason: stateReason } });

export async function createIssue(gh, repo, { title, body, labels = [] }) {
  const { status, json } = await gh(`/repos/${repo}/issues`, { method: 'POST', body: { title, body, labels } });
  // The STATUS is read, not just the body (#the-fleet-froze-on-this): a 403 from a
  // repo whose Actions cannot create issues puts an error object where the issue
  // should be, and a body-only destructure turns that refusal into a plausible
  // object whose `.number` is simply undefined.
  return { status, number: status >= 200 && status < 300 ? json?.number ?? null : null, json };
}

export const readIssue = async (gh, repo, number) => {
  const { status, json } = await gh(`/repos/${repo}/issues/${number}`);
  return status === 200 ? json : null;
};
