// -----------------------------------------------------------------------------
// The Oura account: the OAuth2 authorization code grant of the app the user
// created on the Oura developer portal, as oura-ring runs it (OuraAuth:
// authorize_url, exchange_code, refresh_token).
//
// The browser comes back to the redirect URI of the app:
//   - Gladys' own address (the Connect button of the `oauth2` field): Gladys
//     relays the code to onOAuthCallback;
//   - another one (configuration "redirect URI"): the user pastes the address
//     the browser ended on into the "Finish the authorization" action.
// The password is typed on the Oura page only: it never reaches this code.
// Nothing here logs a token, a code or the client secret.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { AUTHORIZE_URL, LIMITS, SCOPES, TIMINGS, TOKEN_URLS } from './constants.js';
import { OuraError, parseJson, safeCode, transientError } from './http.js';

/** The Oura authorization address for a client id, a redirect URI and a state. */
export function authorizeUrl({ clientId, redirectUri, state }) {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES.join(' '),
    state,
  });
  return `${AUTHORIZE_URL}?${query}`;
}

/**
 * The parameters of a pasted address: `{ code, state, error, base }`, or null
 * when nothing usable is in it. Takes the whole address (`base`: its origin
 * and path, checked against the redirect URI), or only its query string
 * ("?code=…&state=…" or "code=…&state=…", `base` null).
 */
export function parseRedirect(input) {
  const text = String(input ?? '')
    .trim()
    .slice(0, LIMITS.pastedLength);
  if (!text) {
    return null;
  }
  let query;
  let base = null;
  if (/^https?:\/\//i.test(text)) {
    let url;
    try {
      url = new URL(text.split(/\s/)[0]);
    } catch {
      return null;
    }
    query = url.search.slice(1);
    base = baseOf(url);
  } else if (/^[?]?(?:code|state|error)=/.test(text)) {
    query = text.replace(/^[?]/, '').split(/\s/)[0];
  } else {
    return null;
  }
  const params = new URLSearchParams(query);
  const code = params.get('code') || null;
  const result = {
    code: code && code.length <= LIMITS.codeLength ? code : null,
    state: params.get('state') || null,
    error: params.get('error') || null,
    base,
  };
  return result.code || result.error ? result : null;
}

/** The origin and path of an address (no query, no fragment), or null. */
export function baseOf(address) {
  try {
    const url = address instanceof URL ? address : new URL(address);
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

const str = (value) =>
  typeof value === 'string' && value !== '' && value.length <= LIMITS.tokenLength
    ? value
    : undefined;

/** The token answer -> the token kept, or null without an access token. */
export function tokenOf(data, now) {
  const accessToken = str(data?.access_token);
  if (!accessToken) {
    return null;
  }
  const expiresIn = Number(data.expires_in);
  return {
    accessToken,
    refreshToken: str(data.refresh_token) ?? null,
    expiresAt:
      now +
      (Number.isFinite(expiresIn) && expiresIn > 0
        ? Math.min(expiresIn * 1000, 400 * 24 * 3600 * 1000)
        : TIMINGS.defaultTokenLife),
    obtainedAt: now,
  };
}

/**
 * The token endpoint (a code or the renewal token), form-encoded, the client
 * id and secret in the body (oura-ring). 400/401: `refused`, a safe code as
 * detail; 429, 5xx: transient; 200 without a token: `api_error` (never a
 * refusal); another status: `http`.
 */
export async function tokenRequest(
  transport,
  form,
  { endpoint, clientId, clientSecret, now, timeout },
) {
  const body = new URLSearchParams({
    ...form,
    client_id: clientId,
    client_secret: clientSecret,
  }).toString();
  const res = await transport(TOKEN_URLS[endpoint], {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
    timeout,
  });
  const transient = transientError(res, now);
  if (transient) {
    throw transient;
  }
  let data;
  try {
    data = parseJson(res.body);
  } catch (err) {
    if (res.status >= 400) {
      data = undefined;
    } else {
      throw err;
    }
  }
  if (res.status === 400 || res.status === 401) {
    throw new OuraError('refused', 'Oura refused the sign-in', {
      status: res.status,
      detail: safeCode(data?.error) ?? `HTTP ${res.status}`,
    });
  }
  if (res.status !== 200) {
    throw new OuraError('http', 'unexpected answer of the sign-in', { status: res.status });
  }
  const token = tokenOf(data, now);
  if (!token) {
    throw new OuraError('api_error', 'Oura answered without a token');
  }
  return token;
}

/** The sign-ins started (Connect), waiting for their code: state -> { redirectUri, at }. */
export class SignIns {
  constructor({ now }) {
    this.now = now;
    this.pending = new Map();
  }

  /** A new sign-in: its state, kept 15 minutes. */
  begin({ redirectUri }) {
    const now = this.now();
    for (const [state, entry] of this.pending) {
      if (now - entry.at > TIMINGS.signInTtl) {
        this.pending.delete(state);
      }
    }
    while (this.pending.size >= LIMITS.signIns) {
      this.pending.delete(this.pending.keys().next().value);
    }
    const state = randomBytes(16).toString('base64url');
    this.pending.set(state, { redirectUri, at: now });
    return state;
  }

  /** The sign-in of `state` still valid, without using it (null when none). */
  peek(state) {
    const entry = typeof state === 'string' && state ? this.pending.get(state) : undefined;
    return entry && this.now() - entry.at <= TIMINGS.signInTtl ? entry : null;
  }

  /** The sign-in of `state` (a state is required); it serves once. */
  take(state) {
    const entry = typeof state === 'string' && state ? this.pending.get(state) : undefined;
    if (!entry) {
      return null;
    }
    this.pending.delete(state);
    return this.now() - entry.at <= TIMINGS.signInTtl ? { key: state, entry } : null;
  }

  /** Put a sign-in back (Oura was not reached: the same code may be tried again). */
  restore({ key, entry }) {
    this.pending.set(key, entry);
  }

  clear() {
    this.pending.clear();
  }
}
