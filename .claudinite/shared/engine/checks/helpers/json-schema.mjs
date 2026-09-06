// A JSON Schema validator for the subset the corpus's schemas use — draft
// 2020-12 keywords, no remote references, no format vocabulary. It exists so a
// rule about a document's SHAPE (a required field, an allowed value, a type, a
// closed key set) is stated once, in the schema the document points at with
// `$schema`, and enforced by the engine rather than by a per-field declared
// assertion or a coded twin that mirrors the schema by hand. Dependency-free
// like the rest of the engine: a validator library would be the first npm
// install a member ever needs, and the keywords below are what the schemas
// actually spell.
//
// Keywords: type (a name or a list; "integer" is a whole number), enum, const,
// required, properties, additionalProperties (false or a schema),
// patternProperties, propertyNames, items (one schema), minItems, maxItems,
// uniqueItems, minLength, maxLength, pattern, minimum, maximum,
// exclusiveMinimum, exclusiveMaximum, multipleOf, allOf, anyOf, oneOf, not,
// if/then/else, and `$ref` to a local JSON pointer (`#/$defs/name`). Annotation
// keywords (title, description, default, examples, $schema, $id, $comment) and
// anything unknown are ignored, as a real validator ignores them.
//
// validate(doc, schema) -> [{ path, message }], path a JSON pointer into the
// document ('' for the root). Empty means valid.

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

const hasType = (v, name) => {
  if (name === 'integer') return typeof v === 'number' && Number.isInteger(v);
  if (name === 'number') return typeof v === 'number';
  return typeOf(v) === name;
};

const deepEqual = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const canonical = (v) => {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  return v;
};

const show = (v) => {
  const s = JSON.stringify(v);
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
};

function resolveRef(ref, root) {
  if (typeof ref !== 'string' || !ref.startsWith('#')) {
    throw new Error(`$ref ${JSON.stringify(ref)} is not a local JSON pointer — only "#/…" references are supported`);
  }
  let node = root;
  for (const raw of ref.slice(1).split('/').filter(Boolean)) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (node === null || typeof node !== 'object' || !(key in node)) {
      throw new Error(`$ref ${JSON.stringify(ref)} points at nothing in the schema`);
    }
    node = node[key];
  }
  return node;
}

export function validate(doc, schema, { root = schema } = {}) {
  const errors = [];
  const walk = (value, s, path) => {
    if (s === true || s === undefined || s === null) return;
    if (s === false) { errors.push({ path, message: 'no value is allowed here' }); return; }
    if (s.$ref !== undefined) { walk(value, resolveRef(s.$ref, root), path); }

    if (s.type !== undefined) {
      const names = Array.isArray(s.type) ? s.type : [s.type];
      if (!names.some((n) => hasType(value, n))) {
        errors.push({ path, message: `expected ${names.join(' or ')}, got ${typeOf(value)} ${show(value)}` });
        return; // the remaining keywords assume the type
      }
    }
    if (s.enum !== undefined && !s.enum.some((e) => deepEqual(e, value))) {
      errors.push({ path, message: `${show(value)} is not one of ${s.enum.map(show).join(', ')}` });
    }
    if (s.const !== undefined && !deepEqual(s.const, value)) {
      errors.push({ path, message: `${show(value)} is not the required ${show(s.const)}` });
    }

    if (typeof value === 'string') {
      if (s.minLength !== undefined && [...value].length < s.minLength) errors.push({ path, message: `shorter than ${s.minLength} characters` });
      if (s.maxLength !== undefined && [...value].length > s.maxLength) errors.push({ path, message: `longer than ${s.maxLength} characters` });
      if (s.pattern !== undefined && !new RegExp(s.pattern, 'u').test(value)) errors.push({ path, message: `${show(value)} does not match /${s.pattern}/` });
    }
    if (typeof value === 'number') {
      if (s.minimum !== undefined && value < s.minimum) errors.push({ path, message: `${value} is below the minimum ${s.minimum}` });
      if (s.maximum !== undefined && value > s.maximum) errors.push({ path, message: `${value} is above the maximum ${s.maximum}` });
      if (s.exclusiveMinimum !== undefined && value <= s.exclusiveMinimum) errors.push({ path, message: `${value} is not above ${s.exclusiveMinimum}` });
      if (s.exclusiveMaximum !== undefined && value >= s.exclusiveMaximum) errors.push({ path, message: `${value} is not below ${s.exclusiveMaximum}` });
      if (s.multipleOf !== undefined && Math.abs(value / s.multipleOf - Math.round(value / s.multipleOf)) > 1e-9) errors.push({ path, message: `${value} is not a multiple of ${s.multipleOf}` });
    }
    if (Array.isArray(value)) {
      if (s.minItems !== undefined && value.length < s.minItems) errors.push({ path, message: `fewer than ${s.minItems} items` });
      if (s.maxItems !== undefined && value.length > s.maxItems) errors.push({ path, message: `more than ${s.maxItems} items` });
      if (s.uniqueItems && new Set(value.map((v) => JSON.stringify(canonical(v)))).size !== value.length) errors.push({ path, message: 'items are not unique' });
      if (s.items !== undefined) value.forEach((item, i) => walk(item, s.items, `${path}/${i}`));
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const key of s.required ?? []) {
        if (!(key in value)) errors.push({ path, message: `missing the required property "${key}"` });
      }
      const props = s.properties ?? {};
      const patterns = Object.entries(s.patternProperties ?? {});
      for (const [key, v] of Object.entries(value)) {
        const escaped = key.replace(/~/g, '~0').replace(/\//g, '~1');
        let matched = false;
        if (key in props) { matched = true; walk(v, props[key], `${path}/${escaped}`); }
        for (const [re, sub] of patterns) {
          if (new RegExp(re, 'u').test(key)) { matched = true; walk(v, sub, `${path}/${escaped}`); }
        }
        if (s.propertyNames !== undefined) walk(key, s.propertyNames, `${path}/${escaped}`);
        if (!matched && s.additionalProperties !== undefined) {
          if (s.additionalProperties === false) errors.push({ path, message: `the property "${key}" is not allowed` });
          else walk(v, s.additionalProperties, `${path}/${escaped}`);
        }
      }
    }

    const passes = (sub) => validate(value, sub, { root }).length === 0;
    for (const sub of s.allOf ?? []) walk(value, sub, path);
    if (s.anyOf !== undefined && !s.anyOf.some(passes)) errors.push({ path, message: 'matches none of the anyOf alternatives' });
    if (s.oneOf !== undefined && s.oneOf.filter(passes).length !== 1) errors.push({ path, message: 'must match exactly one of the oneOf alternatives' });
    if (s.not !== undefined && passes(s.not)) errors.push({ path, message: 'matches a schema it must not' });
    if (s.if !== undefined) walk(value, passes(s.if) ? s.then : s.else, path);
  };
  walk(doc, schema, '');
  return errors;
}
