// Snapshot data access. The manifest is always fetched `no-store`; every
// other file is cache-busted with its manifest sha256, so a stale CDN copy of
// the manifest can never pin us to mismatched data files. A hash-busted fetch
// that 404s (CDN propagation window) retries once without the buster, then
// fails safe.

import { DATA_BASE, FRESHNESS } from './config.js';

export async function fetchManifest() {
  const res = await fetch(`${DATA_BASE}manifest.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`MANIFEST_HTTP_${res.status}`);
  const manifest = await res.json();
  if (manifest.schemaVersion !== 2) throw new Error('MANIFEST_SCHEMA_MISMATCH');
  return manifest;
}

export async function fetchSnapshotFile(manifest, rel) {
  const hash = manifest?.files?.[rel]?.sha256;
  if (hash) {
    const res = await fetch(`${DATA_BASE}${rel}?v=${hash.slice(0, 16)}`);
    if (res.ok) return res.json();
    // Only a 404 falls through to the no-store retry (a CDN still serving a
    // pre-publish tree). Real server errors must surface, not be masked by a
    // second fetch that could return a version the manifest doesn't describe.
    if (res.status !== 404) throw new Error(`FILE_HTTP_${res.status}`);
  }
  const res = await fetch(`${DATA_BASE}${rel}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`FILE_HTTP_${res.status}`);
  return res.json();
}

export function identityKey(member) {
  return `${member.region}-${member.realmSlug}-${member.id}`;
}

// Pipeline freshness from the manifest's publish time.
// Returns { state: 'fresh'|'aging'|'stale', level: null|'warn'|'alert', ageMs, label }
export function freshness(manifest, now = Date.now()) {
  const published = Date.parse(manifest?.publishedAt || '');
  if (!Number.isFinite(published)) {
    return { state: 'stale', level: 'warn', ageMs: null, label: 'Unknown age' };
  }
  const ageMs = Math.max(0, now - published);
  if (ageMs < FRESHNESS.freshMaxMs) return { state: 'fresh', level: null, ageMs, label: relAge(ageMs) };
  if (ageMs < FRESHNESS.agingMaxMs) return { state: 'aging', level: null, ageMs, label: relAge(ageMs) };
  const level = ageMs > FRESHNESS.alertMaxMs ? 'alert' : 'warn';
  return { state: 'stale', level, ageMs, label: relAge(ageMs) };
}

export function relAge(ms) {
  if (ms < 90e3) return 'just now';
  if (ms < 3600e3) return `${Math.round(ms / 60e3)} min ago`;
  if (ms < 48 * 3600e3) return `${Math.round(ms / 3600e3)} h ago`;
  return `${Math.round(ms / 86400e3)} days ago`;
}
