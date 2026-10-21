// -----------------------------------------------------------------------------
// A fake Oura behind the transport of the app: the token endpoints
// (authorization code, renewal token that serves once) and the API v2
// collections. Every request is recorded; `queue(route, answer)` injects one
// answer.
// -----------------------------------------------------------------------------

import { API_BASE, TOKEN_URLS } from '../../src/constants.js';
import { CLIENT_ID, CLIENT_SECRET, collections } from '../fixtures/oura.js';

const COLLECTION_SCOPES = {
  daily_sleep: 'daily',
  daily_readiness: 'daily',
  daily_activity: 'daily',
  sleep: 'daily',
  daily_spo2: 'spo2Daily',
  heartrate: 'heartrate',
};

export const settle = async (rounds = 30) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

/** /data in memory. */
export function memoryStore(data = null) {
  return {
    data,
    saves: 0,
    async load() {
      return this.data === null ? null : JSON.parse(JSON.stringify(this.data));
    },
    async save(value) {
      this.saves += 1;
      this.data = JSON.parse(JSON.stringify(value));
    },
  };
}

const json = (status, body, headers = {}) => ({
  status,
  headers: { 'content-type': 'application/json', ...headers },
  body: body === undefined ? '' : JSON.stringify(body),
});

export function fakeOura({ expiresIn = 86400, now = () => Date.now() } = {}) {
  const server = {
    requests: [],
    expiresIn,
    /** The collections as functions of the time, or fixed lists. */
    data: null,
    /** The scopes the user granted (all those asked, by default). */
    granted: null,
    issued: 0,
    access: null,
    refresh: null,
    /** Renewal tokens already used: refused (they serve once). */
    used: new Set(),
    /** code -> { redirectUri, clientId, scope } */
    codes: new Map(),
    queued: { token: [] },
    queue(route, answer, times = 1) {
      for (let i = 0; i < times; i += 1) {
        (this.queued[route] ??= []).push(answer);
      }
    },
    /** The user authorizes on the Oura page of `authorizeUrl`: the code and state of the return. */
    approve(authorizeUrl) {
      const url = new URL(authorizeUrl);
      const code = `code-${this.codes.size + 1}-${this.issued}`;
      this.codes.set(code, {
        redirectUri: url.searchParams.get('redirect_uri'),
        clientId: url.searchParams.get('client_id'),
        scope: url.searchParams.get('scope'),
      });
      this.granted ??= new Set((url.searchParams.get('scope') ?? '').split(' '));
      return {
        code,
        state: url.searchParams.get('state'),
        redirectUri: url.searchParams.get('redirect_uri'),
        url,
      };
    },
    revokeAccess() {
      this.access = 'revoked';
    },
    issue() {
      this.issued += 1;
      this.access = `access-${this.issued}`;
      this.refresh = `refresh-${this.issued}`;
      return json(200, {
        access_token: this.access,
        refresh_token: this.refresh,
        expires_in: this.expiresIn,
        token_type: 'bearer',
      });
    },
    of(route) {
      return this.requests.filter((r) => r.route === route);
    },
    get tokenRequests() {
      return this.requests.filter((r) => r.route === 'token');
    },
    get apiRequests() {
      return this.requests.filter((r) => r.route && r.route !== 'token');
    },
    transport: async (url, { method = 'GET', headers = {}, body, timeout } = {}) => {
      const request = { url, method, headers, body, timeout, route: undefined, form: undefined };
      server.requests.push(request);
      if (Object.values(TOKEN_URLS).includes(url)) {
        request.route = 'token';
        request.endpoint = url;
        request.form = Object.fromEntries(new URLSearchParams(body));
      } else if (url.startsWith(`${API_BASE}/`)) {
        const target = new URL(url);
        request.route = target.pathname.slice(new URL(API_BASE).pathname.length + 1);
        request.query = Object.fromEntries(target.searchParams);
      } else {
        return json(404, { detail: 'not found' });
      }
      const injected = server.queued[request.route]?.shift();
      if (injected) {
        return typeof injected === 'function' ? injected(request) : injected;
      }
      if (request.route === 'token') {
        const form = request.form;
        if (form.client_id !== CLIENT_ID || form.client_secret !== CLIENT_SECRET) {
          return json(401, { error: 'invalid_client' });
        }
        if (form.grant_type === 'authorization_code') {
          const entry = server.codes.get(form.code);
          server.codes.delete(form.code);
          if (!entry || entry.clientId !== CLIENT_ID || entry.redirectUri !== form.redirect_uri) {
            return json(400, { error: 'invalid_grant' });
          }
          return server.issue();
        }
        if (form.grant_type === 'refresh_token') {
          if (form.refresh_token !== server.refresh || server.used.has(form.refresh_token)) {
            return json(400, { error: 'invalid_grant' });
          }
          server.used.add(form.refresh_token);
          return server.issue();
        }
        return json(400, { error: 'unsupported_grant_type' });
      }
      if (headers.Authorization !== `Bearer ${server.access}` || !server.access) {
        return json(401, { detail: 'Unauthorized' });
      }
      const scope = COLLECTION_SCOPES[request.route];
      if (!scope) {
        return json(404, { detail: 'not found' });
      }
      if (server.granted && !server.granted.has(scope)) {
        return json(401, { detail: 'scope missing' });
      }
      const all = server.data ?? collections(now());
      const list =
        typeof all[request.route] === 'function' ? all[request.route]() : all[request.route];
      return json(200, { data: list ?? [], next_token: null });
    },
  };
  return server;
}

export const answer = json;
