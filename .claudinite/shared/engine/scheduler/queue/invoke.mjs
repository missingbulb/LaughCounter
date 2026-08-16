// Agent invocation (tasks-dispatch DESIGN §12, §14.6). The executor starts the
// agent session with an API CALL rather than by arming a label event, which is
// what retires the re-arm, the grace window and the transport dance — and what
// makes a lost hand-off a synchronous, visible failure at the executor instead of
// a label event fired into the void.
//
// A TASK NAMES AN ENDPOINT, NEVER A URL. The declaration is vendored verbatim
// into every consuming repo, so it must never carry deployment detail or anything
// adjacent to a credential: `invocation_endpoint: 'fleet'` names a key, and the
// repo's own config maps that key to a URL and to the NAME of the repo Actions
// secret holding its token. That indirection is also what replaces the whole
// self/fleet apparatus — reach is a property of which endpoint you call, so a
// task needing wider access names a different endpoint and nothing else in the
// system needs a concept of scope.
//
// THE PROMPT NAMES ONE ITEM AND CARRIES NO INSTRUCTIONS. Everything
// behavior-defining is read by the session from the tracked task files at HEAD;
// the prompt says which issue and which nonce, and the session validates both in
// code before acting (DESIGN §7).

export const DEFAULT_ENDPOINT = 'default';

// The endpoint is a ROUTINE'S API TRIGGER — `POST /v1/claude_code/routines/
// <trigger-id>/fire` with a per-routine bearer token — which is what Claude Code
// on the web actually exposes to an HTTP caller. Three consequences the design's
// "a CCR API call" did not spell out, each verified against the routines docs
// rather than assumed:
//
//  - THE BEHAVIOR IS THE ROUTINE'S STORED PROMPT, not ours. `text` reaches the
//    session wrapped in a `<routine-fire-payload>` block explicitly labelled
//    untrusted, and a routine acts on it only because its own saved prompt says
//    to. That is the issue-is-data posture arriving for free at one more hop: our
//    payload names an item, and every instruction comes from a stored artifact.
//    The routine's stored prompt is one line pointing at `instructions.md` beside
//    this file, so the whole of what a session does is tracked and reviewed.
//  - THE BODY CARRIES ONE FIELD. `text` is freeform and unparsed — structured
//    JSON would arrive as a literal string — so the item number and nonce go in
//    as prose, and nothing else goes in at all.
//  - THERE IS NO IDEMPOTENCY KEY (standing entry 11, answered: the endpoint
//    offers none), which is exactly why THIS MODULE CALLS ONCE PER ITEM AND NEVER
//    RETRIES. A retry is only safe when you know the first call did nothing, and
//    a client-side timeout is the one case where you cannot know — the session
//    may well have started. Retrying there is what would make invocation
//    at-least-once and put two sessions on one item; declining to retry is what
//    keeps it at-most-once and lets the whole agent-side claim protocol delete.
//    An outcome we did not learn is reported as UNKNOWN and resolved by the agent
//    leash, which is a rule that already exists, rather than by a guess here.
//
// The beta header is dated and the endpoint is a research preview whose two most
// recent header versions keep working, so it lives in config with a default here
// — a rotation is then a config edit on one repo, never an engine release the
// whole fleet waits for.
export const DEFAULT_HEADERS = Object.freeze({
  'anthropic-beta': 'experimental-cc-routine-2026-04-01',
  'anthropic-version': '2023-06-01',
});

// The endpoint a task's hand-off calls, resolved against the repo's config.
// Returns `{ name, url, tokenEnv, headers }` or `{ name, error }` — a task naming
// an endpoint the repo has not configured is a repo-configuration fact, reported
// where the operator reads it, never a crash.
export function resolveEndpoint(config, task) {
  const name = task?.decl?.invocation_endpoint ?? DEFAULT_ENDPOINT;
  const endpoints = config?.taskScheduler?.endpoints ?? {};
  const entry = endpoints[name];
  if (!entry) {
    return { name, error: `this repo's config declares no invocation endpoint "${name}" (taskScheduler.endpoints)` };
  }
  if (!entry.url) return { name, error: `invocation endpoint "${name}" declares no url` };
  if (!entry.tokenSecret) return { name, error: `invocation endpoint "${name}" declares no tokenSecret (the NAME of the repo Actions secret holding its token)` };
  return { name, url: entry.url, tokenEnv: entry.tokenSecret, headers: { ...DEFAULT_HEADERS, ...(entry.headers ?? {}) } };
}

// The fire payload: which item, and the nonce that proves this call is the one
// the hand-off comment recorded. Prose, not JSON — the field is freeform and
// unparsed, so a structured payload would arrive as a literal string — and
// deliberately free of instructions, because the routine's stored prompt is what
// says how to act on it (see `instructions.md`). The session still validates
// the item in code before touching it: a payload labelled untrusted is trusted no
// more than a label event was.
export const firePayload = ({ repo, item, nonce }) =>
  `Claudinite work item: ${repo}#${item.number}. Invocation nonce: ${nonce}.`;

// The invoker seam the executor calls, exactly once per item. Failure is DATA,
// never a throw, and it comes in two kinds the caller must treat differently:
//
//   { ok: true, sessionId, sessionUrl }   the routine fired; a session exists
//   { ok: false, answered: true, error }  the endpoint ANSWERED and refused —
//                                         no session, and the cause is a
//                                         configuration fault a retry cannot fix
//   { ok: false, answered: false, error } no answer reached us — a timeout, a
//                                         dropped connection. The session may or
//                                         may not exist, and nothing here may
//                                         guess which.
export function agentInvoker({ repo, config, env = process.env, fetchImpl = fetch, timeoutMs = 60e3 }) {
  return async function invoke({ task, item, nonce }) {
    const endpoint = resolveEndpoint(config, task);
    // A configuration fault, decided before any call: definite, and no session.
    if (endpoint.error) return { ok: false, answered: true, error: endpoint.error };
    const token = env[endpoint.tokenEnv];
    if (!token) {
      // The `required_secrets` posture, applied to the endpoint token: nothing
      // fails silently, the task just doesn't work yet, and the item names which
      // secret to set (DESIGN §14.7).
      return { ok: false, answered: true, error: `the Actions secret \`${endpoint.tokenEnv}\` for invocation endpoint "${endpoint.name}" is not set in this repo` };
    }

    const payload = { text: firePayload({ repo, item, nonce }) };

    // ONE call. No loop, and deliberately no `attempts` knob for anyone to raise.
    try {
      const res = await fetchImpl(endpoint.url, {
        method: 'POST',
        headers: {
          ...endpoint.headers,
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          'user-agent': 'claudinite-executor',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
      let json = null;
      try { json = await res.json(); } catch { json = null; }
      if (res.status >= 200 && res.status < 300) {
        return {
          ok: true,
          sessionId: json?.claude_code_session_id ?? null,
          sessionUrl: json?.claude_code_session_url ?? null,
        };
      }
      // A status came back, so the endpoint decided: no session was started, and
      // the cause is a token, a URL or a routine — none of which a retry fixes.
      return {
        ok: false, answered: true,
        error: `endpoint "${endpoint.name}" returned ${res.status}${json?.error ? `: ${JSON.stringify(json.error)}` : ''}`,
      };
    } catch (e) {
      // Nothing came back. The request may have landed and started a session, so
      // this is the one outcome that must never be retried and never be reported
      // as a failure — it is genuinely unknown, and the caller says so on the item.
      return { ok: false, answered: false, error: `endpoint "${endpoint.name}" gave no answer: ${e.message}` };
    }
  };
}
