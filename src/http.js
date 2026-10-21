// -----------------------------------------------------------------------------
// The only network access: HTTPS requests to Oura, and the errors they end
// with. The body read is bounded, the promise settles once, nothing secret
// nor any health value ever goes into an error message: a text of Oura is
// only read to classify the error, never shown nor logged (only a safe code).
// -----------------------------------------------------------------------------

import https from 'node:https';
import { LIMITS, TIMINGS } from './constants.js';

/**
 * A failed Oura call. `kind`:
 * - `refused`: the token endpoint refused a code or the renewal token;
 * - `unauthorized`: the API refused the access token (401);
 * - `forbidden`: the API refused the data (403: the membership it needs);
 * - `scope`: a secondary collection refused (scope not granted, feature absent);
 * - `rate_limited`: 429, `retryAfter` in ms when given;
 * - `unavailable`: 5xx;
 * - `budget`: the daily number of requests of this integration is reached;
 * - `network`, `timeout`: no answer;
 * - `api_error`: an answer without the expected content; `bad_response`,
 *   `size`: not the expected answer; `http`: any other status.
 */
export class OuraError extends Error {
  constructor(kind, message, { status, retryAfter, detail } = {}) {
    super(message);
    this.name = 'OuraError';
    this.kind = kind;
    this.status = status;
    this.retryAfter = retryAfter;
    this.detail = detail;
  }
}

const NETWORK_REASONS = {
  ECONNREFUSED: 'connection refused',
  ECONNRESET: 'connection reset',
  EHOSTUNREACH: 'host unreachable',
  ENETUNREACH: 'network unreachable',
  ENOTFOUND: 'unknown host name',
  EAI_AGAIN: 'host name not resolved',
  ETIMEDOUT: 'connection timed out',
  EPIPE: 'connection closed',
};

/** A socket error -> OuraError (never the request: it carries tokens). */
export function networkError(err) {
  if (err instanceof OuraError) {
    return err;
  }
  return new OuraError('network', NETWORK_REASONS[err?.code] ?? 'network error');
}

/** A short reason for a log or a status message: no secret, no health value. */
export function errorReason(err) {
  if (err instanceof OuraError) {
    const code = err.detail ? ` ${err.detail}` : '';
    return err.status ? `${err.message}${code} (HTTP ${err.status})` : `${err.message}${code}`;
  }
  return 'unexpected error';
}

/** A code of Oura made safe for a message: letters, digits, `_.-`, 40 at most. */
export const safeCode = (value) => {
  const text = typeof value === 'number' ? String(value) : value;
  return typeof text === 'string' && /^[A-Za-z0-9_.-]{1,40}$/.test(text) ? text : undefined;
};

/**
 * One HTTPS request; resolves `{ status, headers, body }` whatever the status.
 * The chunks are kept in a list and joined once (linear); the total size is
 * bounded. The tests replace it (the app takes a `transport`).
 */
export function httpsTransport(
  url,
  {
    method = 'GET',
    headers = {},
    body,
    timeout = TIMINGS.requestTimeout,
    maxBytes = LIMITS.responseBytes,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (target.protocol !== 'https:') {
      reject(new OuraError('network', 'only HTTPS is used'));
      return;
    }
    let timer;
    let settled = false;
    const settle = (fn, value) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn(value);
      }
    };
    const req = https.request(target, { method, headers }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          settle(reject, new OuraError('size', 'answer too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () =>
        settle(resolve, {
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
      res.on('error', (err) => settle(reject, networkError(err)));
    });
    timer = setTimeout(
      () => {
        settle(
          reject,
          new OuraError('timeout', `no answer within ${Math.round(timeout / 1000)} s`),
        );
        req.destroy();
      },
      Math.max(1, timeout),
    );
    req.on('error', (err) => settle(reject, networkError(err)));
    req.end(body);
  });
}

/** Retry-After (seconds or an HTTP date) -> milliseconds, undefined when absent. */
export function parseRetryAfter(value, now = Date.now()) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/**
 * The JSON of a body, `undefined` when empty; `bad_response` when it is not
 * JSON. Keys that could reach a prototype are dropped.
 */
export function parseJson(body) {
  if (body === undefined || body === null || String(body).trim() === '') {
    return undefined;
  }
  try {
    return JSON.parse(body, (key, value) =>
      key === '__proto__' || key === 'constructor' || key === 'prototype' ? undefined : value,
    );
  } catch {
    throw new OuraError('bad_response', 'Oura sent an answer that is not JSON');
  }
}

/** The transient errors: 429, 5xx. Undefined otherwise. */
export function transientError({ status, headers = {} }, now) {
  if (status === 429) {
    return new OuraError('rate_limited', 'too many requests', {
      status,
      retryAfter: parseRetryAfter(headers['retry-after'], now),
    });
  }
  if (status >= 500) {
    return new OuraError('unavailable', 'Oura is unavailable', { status });
  }
  return undefined;
}

/** The error of an API answer by its status (the body is never shown), or undefined for 200. */
export function apiError(res, now) {
  const transient = transientError(res, now);
  if (transient) {
    return transient;
  }
  if (res.status === 200) {
    return undefined;
  }
  if (res.status === 401) {
    return new OuraError('unauthorized', 'Oura refused the access token', { status: 401 });
  }
  if (res.status === 403) {
    return new OuraError('forbidden', 'Oura refused the data', { status: 403 });
  }
  return new OuraError('http', 'unexpected answer of Oura', { status: res.status });
}
