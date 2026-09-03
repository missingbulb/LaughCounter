// The merged-PR field derivations, published for other packs: how a pull request names
// the issue it closes, and how a span between two timestamps becomes hours.
//
// Published because the usage fold files a merged PR's lead times under the issue its
// body closes, and a page drawing the same series for the days the fold has not
// reached yet has to find that issue by the same rule — otherwise the two halves of
// one series disagree about which PRs have a lead time at all.
//
// Re-exported from the pure module rather than from the reader beside it: the consumer
// is a page that runs in a browser, where the reader's `process.env` and its listing
// would not load.
export { closesIssueIn, hoursBetween } from '../tasks/usage-fold/pr-fields.mjs';
