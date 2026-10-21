// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { POLL_MINUTES, TOKEN_URLS } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  token_endpoint: 'api',
  poll_minutes: POLL_MINUTES.default,
  language: 'fr',
};

export const LANGUAGES = ['fr', 'en'];

/** A short hash of the client id: the session in /data and the device belong to it. */
export const clientKey = (clientId) =>
  createHash('sha256').update(`gladys-oura:client:${clientId}`).digest('hex').slice(0, 16);

const bounded = (raw, { min, max, default: fallback }) => {
  const value = Number(raw);
  return raw === null || raw === undefined || raw === '' || !Number.isFinite(value)
    ? fallback
    : Math.round(Math.max(min, Math.min(max, value)));
};

/** A short text without spaces (the id and secret of the Oura app), or ''. */
const token = (raw, max = 256) => {
  const text = String(raw ?? '').trim();
  return text && text.length <= max && !/\s/.test(text) ? text : '';
};

/** An http(s) address without spaces, or '' (a wrong one is ignored). */
function address(raw) {
  const text = String(raw ?? '').trim();
  if (!text || text.length > 2048 || /\s/.test(text)) {
    return '';
  }
  try {
    const url = new URL(text);
    // HTTPS only, except a local address (the code never crosses a network in clear).
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return url.protocol === 'https:' || (url.protocol === 'http:' && local) ? url.toString() : '';
  } catch {
    return '';
  }
}

export function normalizeConfig(raw = {}) {
  const clientId = token(raw?.client_id);
  const endpoint = String(raw?.token_endpoint ?? DEFAULTS.token_endpoint)
    .trim()
    .toLowerCase();
  const language = String(raw?.language ?? DEFAULTS.language)
    .trim()
    .toLowerCase();
  return {
    clientId,
    clientSecret: token(raw?.client_secret, 1024),
    tokenEndpoint: Object.hasOwn(TOKEN_URLS, endpoint) ? endpoint : DEFAULTS.token_endpoint,
    redirectUri: address(raw?.redirect_uri),
    // The client key is computed from the value kept, never from a refused one.
    client: clientId ? clientKey(clientId) : '',
    pollMinutes: bounded(raw?.poll_minutes, POLL_MINUTES),
    language: LANGUAGES.includes(language) ? language : DEFAULTS.language,
  };
}
