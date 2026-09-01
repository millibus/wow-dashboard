// Freshness pill (header) + stale banner. The pill reflects the pipeline's
// publish age; the banner adds degraded/carried-forward context for the
// active guild so old data is never silently presented as current.

import { el, clear } from '../dom.js';
import { freshness, relAge } from '../api.js';

export function renderFreshness(container, manifest) {
  clear(container);
  if (!manifest) return;
  const f = freshness(manifest);
  container.className = `freshness is-${f.state}`;
  container.append(
    el('span', { class: 'dot' }),
    el('span', { text: `Updated ${f.label}` }),
  );
}

export function renderStaleBanner(container, manifest, guildSlug) {
  clear(container);
  container.hidden = true;
  container.className = 'stale-banner';

  if (!manifest) {
    container.className = 'stale-banner is-alert';
    container.hidden = false;
    container.append(el('span', {
      text: 'Snapshot data could not be loaded. The dashboard may be offline — try again shortly.',
    }));
    return;
  }

  const f = freshness(manifest);
  const guild = manifest.guilds?.[guildSlug];
  const messages = [];
  let level = null;

  if (f.state === 'stale') {
    level = f.level;
    messages.push(`This data is ${f.label.replace(' ago', '')} old — the refresh pipeline appears to be down.`);
  }
  if (guild?.status === 'unavailable') {
    level = 'alert';
    messages.push('This guild could not be fetched at all in the last run.');
  } else if (guild?.status === 'carried_forward') {
    level = level || 'warn';
    const src = Date.parse(guild.sourceUpdatedAt || '');
    const age = Number.isFinite(src) ? relAge(Math.max(0, Date.now() - src)) : 'an earlier run';
    messages.push(`Showing this guild's last good data (from ${age}).`);
  } else if (guild?.status === 'degraded') {
    // Degraded but roster-fresh: per-character component badges tell the
    // story; no banner needed.
  }
  if (manifest.overallStatus === 'failed') {
    level = 'alert';
    if (!messages.length) messages.push('The last refresh failed for every guild.');
  }

  if (!messages.length) return;
  container.className = `stale-banner is-${level || 'warn'}`;
  container.hidden = false;
  container.append(el('span', { text: messages.join(' ') }));
}
