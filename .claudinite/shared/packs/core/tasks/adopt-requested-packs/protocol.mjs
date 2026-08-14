// The add-packs ISSUE PROTOCOL — the contract between the fleet enforcer's
// fleet-add-missing-packs task (sheepdog pack — WRITES work-list issues into
// members) and each member's own adopt-requested-packs task (grow_with_claudinite
// pack — READS its own repo's and adopts).
//
// TWO COPIES, ONE SHAPE. Packs import only the engine surface, never each other
// (pack-independence), so the member-side task carries its own byte-identical copy
// of this file and a cross-pack test
// (packs-tests/sheepdog/tasks/fleet-add-missing-packs/protocol.test.mjs) pins the
// two together. Change either copy and that test names the other.
//
// The protocol is deliberately tiny: one label, two converged issue titles, and the
// one body element that is DATA rather than prose — the fenced JSON block whose
// array is the declaration entries to write. Everything else in an issue body is
// for the human and the agent to read, not to parse.

// The label every add-packs work-list issue in a member carries. The member task's
// prework counts open issues under it; the enforcer's sweep converges them.
export const LABEL = 'add-packs';

// Exactly one converged issue per kind per member — the title IS the convergence key.
//
//   REQUESTED — an owner named these packs, with config and interview answers, on a
//   forced fleet run. Not a suspicion: the member's agent adopts what the JSON block
//   says, verbatim, and never re-litigates whether it was wanted.
//
//   SUSPECTED — the weekly fleet scan fingerprinted the member's shape against packs
//   its declaration does not carry. A suspicion, not a verdict: the member's agent
//   confirms each pack against the checkout before declaring it, declines with a
//   reason, and a `not planned` close is a standing answer the scan honours.
export const REQUESTED_TITLE = 'Add packs: requested for this repo';
export const SUSPECTED_TITLE = 'Add packs: suspected from this repo’s shape';

// The declaration entries a REQUESTED issue carries, read back out of its body. The
// body renders them as a fenced JSON array precisely so this is a parse and not a
// guess; a body whose block cannot be read yields null, and every caller treats null
// as "leave it for a human" — never as an empty request.
export function entriesIn(body) {
  const m = /```json\n([\s\S]*?)\n```/.exec(String(body ?? ''));
  if (!m) return null;
  try {
    const entries = JSON.parse(m[1]);
    if (!Array.isArray(entries)) return null;
    const ids = entries.filter((e) => typeof e?.id === 'string');
    return ids.length ? entries : null;
  } catch { return null; }
}
