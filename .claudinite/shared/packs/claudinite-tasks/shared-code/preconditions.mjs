// The precondition engine, published for other packs: the term vocabulary, the
// expression grammar, and the one seam that turns a discovered task plus its
// collected signals into a verdict — the same call the executor makes at pick.
export * from '../precondition-policy.mjs';
export { loadTaskTerms, TASK_TERMS_FILE } from '../task-terms.mjs';
export { evaluatePrecondition } from '../queue/executor.mjs';
