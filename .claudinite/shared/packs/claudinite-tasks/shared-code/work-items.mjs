// The work-item vocabulary, published for other packs: the title grammar that IS a
// work item's identity, the outcome/status decode over its labels (every legacy
// spelling included), lease state, and the dispatch vocabulary items are minted from.
// Re-exported rather than reimplemented so a consumer and the queue can never disagree
// about what a title means.
export * from '../queue/work-item.mjs';
export { isQueueItem } from '../queue/read.mjs';
export * from '../queue/leases.mjs';
export * from '../dispatch.mjs';
