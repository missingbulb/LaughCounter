// The merged-PR fields, derived. Pure by construction and separated from the listing
// that fetches them ([`read-prs.mjs`](read-prs.mjs)) for the same reason the fold's
// counting core is separated from its worker — and for one more: these two are the
// only part of the merged-PR read another pack needs, and they are published through
// `shared-code/` to a PAGE that runs in a browser, where a module reaching for
// `process.env` or a node builtin does not load at all.

// The closing keyword GitHub itself acts on, which is also what this repo's lifecycle
// asks a PR body to carry. The FIRST match wins: a PR closing several issues has one
// issue it is *for*, and it is the one named first.
const CLOSES_RE = /(?:^|\n)[^\S\n]*(?:closes|fixes|resolves)[^\S\n]+#(\d+)\b/i;

export function closesIssueIn(body) {
  const n = Number(CLOSES_RE.exec(String(body ?? ''))?.[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// A span in hours, to one decimal. Absent at either end is `null` — an unknown lead
// time, which is not a zero one — and so is a span whose ends arrive in the wrong
// order, which says the two clocks disagree rather than that the work took less than
// no time.
export function hoursBetween(from, to) {
  if (!from || !to) return null;
  const hours = (Date.parse(to) - Date.parse(from)) / 3600000;
  if (!Number.isFinite(hours) || hours < 0) return null;
  return Math.round(hours * 10) / 10;
}
