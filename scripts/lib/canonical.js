'use strict';
// Canonical JSON serialization: recursively sorted object keys, no whitespace.
// Two structurally equal values always produce identical bytes, so unchanged
// data files stay byte-identical across runs (no git churn, stable hashes).

function sortValue(v) {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortValue(v[k]);
    return out;
  }
  return v;
}

function canonicalStringify(value) {
  return JSON.stringify(sortValue(value));
}

// Keys whose values change every run without the data itself changing. Files
// are considered unchanged — and their previous bytes (and timestamps) kept —
// when they are canonically equal after dropping these.
const VOLATILE_KEYS = new Set([
  'updatedAt', 'carriedForwardAt', 'sourceUpdatedAt', 'fetchedAt', 'lastUpdated', 'ts',
]);

function stripVolatile(v) {
  if (Array.isArray(v)) return v.map(stripVolatile);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) {
      if (!VOLATILE_KEYS.has(k)) out[k] = stripVolatile(v[k]);
    }
    return out;
  }
  return v;
}

function contentEquals(a, b) {
  return canonicalStringify(stripVolatile(a)) === canonicalStringify(stripVolatile(b));
}

module.exports = { canonicalStringify, contentEquals };
