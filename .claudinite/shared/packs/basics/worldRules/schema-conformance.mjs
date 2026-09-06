import { dirname, join, normalize } from 'node:path';
import { finding } from '../../../engine/checks/helpers/findings.mjs';
// A namespace import with a capability probe, not a named one: the pack and
// engine lanes deliver on their own cadences, and a member holding this pack
// beside an engine that predates the validator must load the pack, not fault it.
import * as jsonSchema from '../../../engine/checks/helpers/json-schema.mjs';

// A document that points at a schema (`"$schema": "<repo-relative path>"`) has
// declared its own contract, and the schema is where a rule about the
// document's SHAPE lives — a required field, an allowed value, a closed key set
// — enforced here for every such document at once rather than restated per
// field as a declared assertion or mirrored by hand in a coded check. A `$schema`
// naming a URL (the meta-schema, a published vocabulary) is an editor's hint
// this engine cannot fetch and does not judge.
//
// RELEVANCE FIRST (engine/checks/README.md): inert on any tree whose documents
// point at no repo-relative schema.
const rule = {
  id: 'schema-conformance',
  severity: 'blocking',
  since: '2026-09-04',
  description: 'Every JSON document whose $schema is a repo-relative path satisfies that schema',
  doc: 'engine/checks/README.md',
  why: 'the schema a document points at is its contract, and a document that drifts from it is read by an editor as wrong and by the engine as nothing — so the drift only surfaces when the reader that consumes the document breaks',

  run(ctx) {
    if (typeof jsonSchema.validate !== 'function') return [];
    const out = [];
    for (const file of ctx.files) {
      if (!file.endsWith('.json') || file.endsWith('.schema.json')) continue;
      const text = ctx.read(file);
      let doc;
      try { doc = JSON.parse(text); } catch { continue; } // an unparsable document is another rule's finding
      if (!doc || typeof doc !== 'object' || typeof doc.$schema !== 'string' || /^[a-z]+:/i.test(doc.$schema)) continue;
      const schemaPath = normalize(join(dirname(file), doc.$schema)).split('\\').join('/');
      const schemaText = ctx.read(schemaPath);
      if (schemaText === null) {
        out.push(finding(rule, {
          file, line: lineOf(text, '$schema'),
          what: `points at ${schemaPath} as its schema, which is not in the tree`,
          fix: 'point $schema at the schema file, relative to this document, or drop the field',
        }));
        continue;
      }
      let schema;
      try { schema = JSON.parse(schemaText); } catch (e) {
        out.push(finding(rule, { file: schemaPath, what: `is not valid JSON, so ${file} cannot be judged against it: ${e.message}`, fix: 'fix the schema file' }));
        continue;
      }
      let errors;
      try { errors = jsonSchema.validate(doc, schema); } catch (e) {
        out.push(finding(rule, { file: schemaPath, what: `cannot be applied: ${e.message}`, fix: 'fix the schema file' }));
        continue;
      }
      for (const { path, message } of errors) {
        const key = path.split('/').filter(Boolean).at(-1);
        out.push(finding(rule, {
          file, line: key ? lineOf(text, key) : null,
          what: `${path ? `at ${path}` : 'the document'}: ${message} (against ${schemaPath})`,
          fix: 'bring the document to the schema\'s shape, or change the schema when the shape is right — the schema is the contract',
        }));
      }
    }
    return out;
  },
};

// The 1-indexed line carrying `"key"`, or null — a best-effort anchor, since a
// parsed document has no positions.
function lineOf(text, key) {
  const needle = `"${key.replace(/~1/g, '/').replace(/~0/g, '~')}"`;
  const lines = text.split('\n');
  const i = lines.findIndex((l) => l.includes(needle));
  return i === -1 ? null : i + 1;
}

export default rule;
