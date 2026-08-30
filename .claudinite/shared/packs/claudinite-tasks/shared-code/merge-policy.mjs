// The auto-merge policy engine, published for other packs: the verdict a
// `automerge` declaration compiles to, and the merge-rules.json compiler, so
// a pack's own tests can assert its policies and declared rules against the same
// evaluator the landing lane and the automerge-policy-scope gate apply.
export * from '../merge-policy.mjs';
