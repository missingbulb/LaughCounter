import routineStructure from './routine-structure.mjs';

// A skill owns the test-the-world checks that validate the action its SKILL.md
// defines — kept beside the prose they enforce, not scattered into a pack. The
// runner discovers any skills/<name>/checks.mjs (default export = an array of
// coded rules) plus the declarations beside it in declared-checks.json, and runs
// them unconditionally — skills aren't declared the way packs are; these are
// standing invariants, inert until their artifact exists.
export default [routineStructure];
