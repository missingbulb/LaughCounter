import { finding } from '../../../engine/checks/helpers/findings.mjs';
import { stripComments } from '../../../engine/checks/helpers/code-scanning.mjs';

// Converted from this pack's app-bundle prose: `Package.swift`'s `platforms:`
// floor and `Info.plist`'s `LSMinimumSystemVersion` are two independent claims
// about the same minimum OS, and only ONE of them is enforced at launch. When
// they drift, the claim that is enforced wins in silence — Launch Services
// refuses (or admits) a Mac the package disagrees about, while `swift build`
// compiles happily against the other floor and no build step compares them.
//
// A plain two-files-must-agree invariant, and gated on both claims being present
// AND readable: no near-root `Package.swift` declaring a macOS floor, or a plist
// whose value is a build substitution (`$(MACOSX_DEPLOYMENT_TARGET)`) rather
// than a version, and there is nothing to compare. Absence is never a finding —
// which plist is "the app's Info.plist" is not something a scan can know, so the
// rule judges only a plist that already makes the claim.
//
// Parsed, not grepped, on both sides. `Package.swift` is read comments-stripped
// and the `.macOS(…)` calls are taken from inside the `platforms:` array's own
// brackets, so a `.macOS(` in a doc comment or in a target's build condition is
// not a floor. Plists have their XML comments blanked length-preservingly, so a
// commented-out key is not a claim and the finding's line still points at the
// real one. `14`, `14.0` and `14.0.0` are one floor — the comparison is on the
// trailing-zero-free form, not the string.
//
// Blocking: the drift ships a wrong floor to users, and nothing in the build,
// the test suite or the notarization lane reports it.

// The pack's own fingerprint depth: a `Package.swift` at the repo root or one
// directory down (a monorepo's `mac/`), never deeper — so a fixture package
// nested in a test tree is not this repo's package.
const isPackageManifest = (f) => {
  const parts = f.split('/');
  return parts.at(-1) === 'Package.swift' && parts.length <= 2;
};

const PLIST = /\.plist$/;
const PLATFORMS_KEY = /\bplatforms\s*:/;
const MACOS_CALL = /\.macOS\s*\(([^()]*)\)/g;
const LS_MINIMUM = /<\s*key\s*>\s*LSMinimumSystemVersion\s*<\s*\/\s*key\s*>\s*<\s*string\s*>\s*([^<]*?)\s*<\s*\/\s*string\s*>/;
const VERSION_LITERAL = /^\d+(?:\.\d+)*$/;

// Length-preserving, so a finding's line number survives the blanking.
const blankXmlComments = (text) =>
  text.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));

// The balanced `[ … ]` that follows `from`; null when there is none.
function bracketSpan(text, from) {
  const open = text.indexOf('[', from);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '[') depth += 1;
    else if (text[i] === ']') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
}

// `.v14` → [14]; `.v10_15` → [10, 15]; `"14.1"` → [14, 1]. Anything else — a
// named constant, `.custom(…)` — is a floor this check cannot read, and an
// unreadable floor is not a disagreement.
function platformVersion(arg) {
  const enumForm = /^\s*\.v(\d+)(?:_(\d+))?\s*$/.exec(arg);
  if (enumForm) {
    return enumForm[2] === undefined
      ? [Number(enumForm[1])]
      : [Number(enumForm[1]), Number(enumForm[2])];
  }
  const stringForm = /^\s*["'](\d+(?:\.\d+)*)["']\s*$/.exec(arg);
  return stringForm ? stringForm[1].split('.').map(Number) : null;
}

const canonical = (parts) => {
  const p = [...parts];
  while (p.length > 1 && p.at(-1) === 0) p.pop();
  return p.join('.');
};

const rule = {
  id: 'minimum-system-version-agrees',
  severity: 'blocking',
  description: "Info.plist's LSMinimumSystemVersion states the same OS floor as the package's platforms: [.macOS(…)]",
  doc: 'packs/macos/skills/macos-app-bundle/SKILL.md',
  why: 'the two are independent claims about the same minimum OS and only one of them is enforced at launch, so a drift ships a floor nobody chose and no build step compares them',

  run(ctx) {
    // Every macOS floor the near-root package manifests declare, keyed by its
    // canonical form so 14 / 14.0 / 14.0.0 collapse to one answer.
    const floors = new Map();
    for (const file of ctx.files.filter(isPackageManifest)) {
      const raw = ctx.read(file);
      if (raw === null) continue;
      const text = stripComments(raw);
      const at = text.search(PLATFORMS_KEY);
      if (at < 0) continue;
      const list = bracketSpan(text, at);
      if (list === null) continue;
      for (const m of list.matchAll(MACOS_CALL)) {
        const version = platformVersion(m[1]);
        if (version) floors.set(canonical(version), { file, written: m[1].trim() });
      }
    }
    if (floors.size === 0) return [];

    const out = [];
    for (const file of ctx.files.filter((f) => PLIST.test(f))) {
      const raw = ctx.read(file);
      if (raw === null) continue;
      const text = blankXmlComments(raw);
      const claim = LS_MINIMUM.exec(text);
      if (!claim || !VERSION_LITERAL.test(claim[1])) continue;
      if (floors.has(canonical(claim[1].split('.').map(Number)))) continue;
      const [expected, source] = [...floors.entries()][0];
      out.push(finding(rule, {
        file,
        line: text.slice(0, claim.index).split('\n').length,
        what: `LSMinimumSystemVersion is ${claim[1]}, but ${source.file} declares a macOS floor of ${expected} (.macOS(${source.written}))`,
        fix: `make the two claims one OS version — either <string>${expected}</string> here, or move the package's platforms: [.macOS(…)] to ${claim[1]}`,
      }));
    }
    return out;
  },
};

export default rule;
