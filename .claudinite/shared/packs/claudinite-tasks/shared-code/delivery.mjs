// The delivery lane, published for other packs: how a task's output becomes a landed
// pull request or a regenerated file, honoring the repo's delivery settings.
export * from '../land-pr.mjs';
export * from '../deliver-generated.mjs';
// …and the trailer every lane stamps, so a pack writing its own commits can say
// which task wrote them without reaching past this published seam.
export * from '../task-trailer.mjs';
