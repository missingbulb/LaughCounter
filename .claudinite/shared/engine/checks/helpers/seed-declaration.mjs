// Seed a fresh repo's settings file — the write behind
// `check_the_world.mjs --init` and bootstrap.mjs's first step, extracted so the
// two callers cannot drift. Returns { path, existed, declared }; writes only when
// the file is absent.
import { writeFileSync, existsSync } from 'node:fs';
import { buildContext } from './repo-context.mjs';
import { settingsPath } from '../../settings-file.mjs';
import { resolveDeclaredPacks } from '../../pack_loader/pack-registry.mjs';

export function seedDeclaration(root, packs) {
  const path = settingsPath(root);
  if (existsSync(path)) return { path, existed: true, declared: null };
  const ctx = buildContext({ root, mode: 'all' });
  // No pack is active by default, so the baseline is seeded as an explicit
  // declaration alongside the fingerprinted packs: every pack that flags
  // `seededByDefault` is written in (discovered structurally — the engine names
  // no pack), plus the ones a fingerprint detects. A seeded pack is still
  // opt-out-able where its own policy allows (the update flows re-add only the packs
  // whose absence it treats as drift), so removing a seeded declaration can
  // stick; each seeded pack ships its own one-time seed migration for the fleet.
  // Local packs are declared by hand, never fingerprinted or seeded — exclude
  // them from the seeding so a repo that already carries local packs (but
  // no config yet) doesn't auto-declare them.
  const seeded = packs.filter((p) => p.seededByDefault && !p.local).map((p) => p.id);
  const detected = [...seeded, ...packs.filter((p) => p.detect && !p.local && p.detect(ctx)).map((p) => p.id)];
  // A pack can't be imported without its dependencies — pull each declared pack's
  // `requires` closure into the declaration so it's complete and visible.
  const declared = resolveDeclaredPacks(detected, packs);
  // ONLY the declaration. The delivery preference used to be materialized here so the
  // selection was visible where a project would change it — but every project made
  // the same selection, so the line said nothing and the file carried it anyway.
  // It is an override now (`dailyClaudiniteUpdatesRequirePrReview`, #1252): absent
  // means the update PR lands, and the one project that wants a human writes it in.
  // Empty rules/accept boilerplate is noise, not settings (#385); loadConfig defaults
  // every absent key.
  writeFileSync(path, `${JSON.stringify({ packs: declared }, null, 2)}\n`);
  return { path, existed: false, declared };
}
