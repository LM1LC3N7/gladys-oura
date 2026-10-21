// -----------------------------------------------------------------------------
// What must survive a restart, in /data (the only writable place of the
// container). Never a password (it is typed on the Oura page only), never
// the client secret (kept by Gladys), never a health value:
//   - the session: the access and renewal tokens with their ends, and the
//     client they belong to (a hash of the client id);
//   - a stop that only the user can lift (renewal refused, access refused
//     with a new token), with its client, so a restart never retries it;
//   - when the last cycle succeeded (a restart before the next read stays
//     connected), cleared by any failure, pause or stop;
//   - the end of a 429, 5xx, 403, daily budget or error pause, capped when
//     read again, and when the last read cycle started (a restart never
//     reads sooner);
//   - when the token was last renewed (never two renewals within a minute);
//   - the requests sent today (the daily budget).
// The tokens are kept as Oura gives them, in clear, in a file readable by
// the container user only (0600).
// -----------------------------------------------------------------------------

import { open, readFile, rename } from 'node:fs/promises';
import { DAY, LIMITS, TIMINGS } from './constants.js';

export const STATE_FILE = '/data/oura-state.json';

export function fileStore(path = STATE_FILE) {
  // One write at a time: two saves never share the temporary file.
  let chain = Promise.resolve();
  return {
    async load() {
      try {
        return JSON.parse(await readFile(path, 'utf8'));
      } catch {
        return null;
      }
    },
    save(data) {
      const text = JSON.stringify(data);
      const write = chain.then(async () => {
        const temporary = `${path}.tmp`;
        const file = await open(temporary, 'w', 0o600);
        try {
          await file.chmod(0o600);
          await file.writeFile(text);
          // On disk before it replaces the previous state (a power cut keeps one of the two).
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(temporary, path);
      });
      chain = write.catch(() => {});
      return write;
    },
  };
}

const time = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const str = (value, max) =>
  typeof value === 'string' && value !== '' && value.length <= max ? value : undefined;
const client = (value) =>
  typeof value === 'string' && /^[0-9a-f]{16}$/.test(value) ? value : undefined;

const BLOCKS = new Set(['expired', 'unauthorized']);
export const PAUSES = {
  rate: TIMINGS.rateLimitMax,
  unavailable: TIMINGS.unavailable.at(-1),
  forbidden: TIMINGS.forbidden,
  budget: DAY,
  backoff: TIMINGS.backoffMax,
};

function session(raw) {
  const s = raw?.session;
  const owner = client(s?.client);
  const refreshToken = str(s?.refreshToken, LIMITS.tokenLength);
  if (!owner || !refreshToken) {
    return null;
  }
  return {
    client: owner,
    accessToken: str(s.accessToken, LIMITS.tokenLength) ?? null,
    refreshToken,
    expiresAt: time(s.expiresAt) ?? 0,
    obtainedAt: time(s.obtainedAt) ?? 0,
  };
}

/** The UTC day of a time: the daily budget counts from 00:00 UTC. */
export const dayOf = (now) => Math.floor(now / DAY);

/** The persisted state, repaired; the pause end is capped from `now`. */
export function normalizeMemory(raw, now = Date.now()) {
  const block = raw?.block;
  const pause = raw?.pause;
  const until = time(pause?.until);
  const lastRenewAt = time(raw?.lastRenewAt);
  const lastCycleAt = time(raw?.lastCycleAt);
  const lastSuccessAt = time(raw?.lastSuccessAt);
  const requests = raw?.requests;
  return {
    session: session(raw),
    block:
      BLOCKS.has(block?.kind) && client(block?.client)
        ? { kind: block.kind, client: block.client }
        : null,
    pause:
      pause && Object.hasOwn(PAUSES, pause.kind) && until !== undefined && until > now
        ? { kind: pause.kind, until: Math.min(until, now + PAUSES[pause.kind]) }
        : null,
    // A time ahead of the clock counts as now (never a renewal blocked for long).
    lastRenewAt: lastRenewAt === undefined ? null : Math.min(lastRenewAt, now),
    // The start of the last read cycle: the first read after a restart waits the interval.
    lastCycleAt: lastCycleAt === undefined ? null : Math.min(lastCycleAt, now),
    // The start of the last cycle that succeeded, cleared by any failure, pause or stop.
    lastSuccessAt: lastSuccessAt === undefined ? null : Math.min(lastSuccessAt, now),
    // The requests of today only; another day starts from 0.
    requests:
      requests && requests.day === dayOf(now) && Number.isSafeInteger(requests.count)
        ? { day: requests.day, count: Math.max(0, requests.count) }
        : { day: dayOf(now), count: 0 },
  };
}
