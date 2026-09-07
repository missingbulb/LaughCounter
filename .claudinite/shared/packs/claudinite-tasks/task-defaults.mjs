// THE DEFAULTS, and the one place a declaration's absent field becomes a value,
// so nothing downstream ever reads an undefined one (owner, 2026-09-03):
//   - `automerge`: land nothing unreviewed — `'nothing'`, for a task that may open a PR
//     (every outcome but `no_code_changes`).
//   - `agent_model`: no agent — `'none'`.
//   - `code_work`: no code work; `agent_instructions`: none.
// Neither timeout has a default, deliberately: an agent or a code-work
// subprocess always carries its own time limit, so the field is required
// wherever the phase it bounds is declared. `preconditions` and `expected_outcome`
// have no default either — each is a choice the author makes: the expression is
// the whole of when the task runs (tasks-dispatch DESIGN §5), and an absent one has
// not said.
// A task that declares a field keeps it; only an absent one is filled.
export const DEFAULT_AUTOMERGE = 'nothing';
export const DEFAULT_AGENT_MODEL = 'none';

// Fill the absent fields in place and return the declaration.
export function applyTaskDefaults(out) {
  if (out.agent_model === undefined) out.agent_model = DEFAULT_AGENT_MODEL;
  if (out.expected_outcome !== undefined && out.expected_outcome !== 'no_code_changes' && out.automerge === undefined) out.automerge = DEFAULT_AUTOMERGE;
  return out;
}
