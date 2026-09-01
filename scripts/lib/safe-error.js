'use strict';
// Central sanitizer for everything the pipeline logs.
//
// GitHub Actions log masking is NOT a security boundary: serializing an axios
// error prints the request config, including the Authorization header. No code
// in this pipeline may log an error object, a request/response, or a config —
// errors must pass through toSafeError()/logSafeError(), and every string that
// reaches stdout/stderr must pass through redact().

const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNABORTED',
  'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'ERR_SOCKET_CONNECTION_TIMEOUT',
]);

function collectSecrets() {
  const id = process.env.BLIZZARD_CLIENT_ID;
  const secret = process.env.BLIZZARD_CLIENT_SECRET;
  const values = [];
  for (const v of [id, secret]) {
    if (v && v.length >= 6) {
      values.push(v);
      values.push(Buffer.from(v).toString('base64'));
    }
  }
  if (id && secret) {
    // Basic-auth form used on the OAuth request: base64("id:secret").
    values.push(Buffer.from(`${id}:${secret}`).toString('base64'));
  }
  return values;
}

// Replace any occurrence of the configured credentials (raw or Base64) in a
// string. Belt-and-braces on top of never logging them in the first place.
function redact(str) {
  let out = String(str);
  for (const secret of collectSecrets()) {
    out = out.split(secret).join('[REDACTED]');
  }
  return out;
}

function isHttpError(err) {
  return Boolean(err && typeof err === 'object' && (err.isAxiosError || err.config || err.response));
}

// Classify an error into a compact, safe code.
function safeCode(err) {
  if (!err || typeof err !== 'object') return 'UNKNOWN';
  if (typeof err.safeCode === 'string') return err.safeCode; // our own typed errors
  const status = err.response && err.response.status;
  if (typeof status === 'number') return `HTTP_${status}`;
  if (typeof err.code === 'string' && RETRYABLE_NETWORK_CODES.has(err.code)) return `NETWORK_${err.code}`;
  if (typeof err.code === 'string' && /^E[A-Z_]+$/.test(err.code)) return `NETWORK_${err.code}`;
  return 'UNKNOWN';
}

// Reduce any error to fields that are safe to log. Never returns headers,
// bodies, tokens, or full URLs (query strings are dropped with the rest of the
// URL — only the pathname survives).
function toSafeError(err, extra = {}) {
  const out = { code: safeCode(err), ...extra };
  if (err && typeof err === 'object') {
    const status = err.response && err.response.status;
    if (typeof status === 'number') out.status = status;
    if (err.config && typeof err.config === 'object') {
      if (typeof err.config.method === 'string') out.method = err.config.method.toUpperCase();
      if (typeof err.config.url === 'string') {
        try { out.path = new URL(err.config.url).pathname; } catch (_) { /* not a full URL — drop it */ }
      }
    }
    // Plain (non-HTTP) errors we threw ourselves carry a controlled message.
    if (!isHttpError(err) && typeof err.message === 'string') {
      out.message = redact(err.message);
    }
  }
  return out;
}

function formatSafeError(err, extra = {}) {
  const safe = toSafeError(err, extra);
  const parts = [safe.code];
  if (safe.status !== undefined) parts.push(`status=${safe.status}`);
  if (safe.method) parts.push(safe.method);
  if (safe.path) parts.push(safe.path);
  if (safe.attempt !== undefined) parts.push(`attempt=${safe.attempt}`);
  if (safe.requestId) parts.push(`requestId=${safe.requestId}`);
  if (safe.message) parts.push(`- ${safe.message}`);
  return redact(parts.join(' '));
}

function logSafeError(prefix, err, extra = {}) {
  console.error(redact(`${prefix}: ${formatSafeError(err, extra)}`));
}

module.exports = { redact, safeCode, toSafeError, formatSafeError, logSafeError };
