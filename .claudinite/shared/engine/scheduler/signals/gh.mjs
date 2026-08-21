// The Action-side GitHub reader for the scheduler (per-project-scheduling
// DESIGN §10: engine/scheduler/ is the one place that legitimately uses the
// Action's GITHUB_TOKEN — everything session-side stays MCP-only). A minimal
// REST client over global fetch: `gh(path) -> { status, json }`, the same shape
// the fleet planner's injected reader uses, so the collectors read uniformly and
// test against a fake `gh`.
//
// `path` is an API path beginning with `/` (e.g. `/repos/owner/name/commits`);
// the base URL and auth are applied here. A non-2xx returns `{ status, json:
// null }` rather than throwing, so a 404 (no release yet, missing file) is data,
// not an error.

const API = process.env.GITHUB_API_URL || 'https://api.github.com';

export function makeGh({ token = process.env.GITHUB_TOKEN, api = API, fetchImpl = fetch } = {}) {
  // `gh(path)` reads; `gh(path, { method, body })` writes (body JSON-encoded).
  return async function gh(path, { method = 'GET', body } = {}) {
    const res = await fetchImpl(`${api}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'user-agent': 'claudinite-scheduler',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    return { status: res.status, json };
  };
}

// The scheduler workflow's file name — the vendored shim's, identical in every
// member (the workflow is core, not pack content) and unchanged by the move to the
// work-item queue, which put the scheduler run at this same path. Named here rather than
// restated: the usage fold finds a repo's scheduler runs by it, to read their logs
// for the task-invocation records.
export const SCHEDULER_WORKFLOW_FILE = 'claudinite-scheduler.yml';

// The executor workflow's file name, same contract: identical in every member,
// and the target of every `workflow_dispatch` in the queue's chain (DESIGN §10) —
// the close-time drain, a run's own re-dispatch, and the failure continuation.
export const EXECUTOR_WORKFLOW_FILE = 'claudinite-executor.yml';

// The repo slug (owner/name) and default branch the workflow runs against, from
// the Actions environment. `GITHUB_REPOSITORY` is always set in a workflow;
// `GITHUB_REF_NAME` is the branch for a scheduled/dispatch run on the default branch.
export function actionRepoContext(env = process.env) {
  return {
    repo: env.GITHUB_REPOSITORY || null,
    defaultBranch: env.GITHUB_REF_NAME || 'main',
  };
}
