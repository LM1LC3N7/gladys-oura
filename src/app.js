// -----------------------------------------------------------------------------
// The integration: the Oura account (OAuth2 of the app the user created,
// started by a click), the token renewed by a timer before its end, one read
// of the collections per cycle (15 minutes at least), one Gladys device and
// its states (read only), the transport badge and the configuration buttons.
// index.js only wires the SDK handlers to it. The authorization model is the
// one of gladys-sungrow (approved).
//
// Never by itself: a sign-in, a retry of a refused renewal or access, a read
// sooner than the interval (after an error, a test click, a Discovery scan,
// a reconnection to Gladys, a configuration saved unchanged or a restart:
// the start of the last cycle is kept in /data), two renewals at once, more
// than LIMITS.dailyRequests requests a day. Pauses (429, 5xx, 403, daily
// budget, errors) and stops are kept in /data; a reconnection to Gladys
// resends the status and the Discovery list without touching them.
//
// Health data: read only, kept in memory only (never in /data), never in a
// log nor a status message. Not a medical device.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { getCollection, queryOf } from './api.js';
import { normalizeConfig } from './config.js';
import { COLLECTIONS, DAY, LIMITS, MINUTE, PRIMARY, SECOND, TIMINGS } from './constants.js';
import { buildDevice, deviceIds, deviceStates } from './devices.js';
import { OuraError, errorReason, httpsTransport, networkError, safeCode } from './http.js';
import { COLLECTION_NAMES, T, age, join } from './i18n.js';
import { valuesOf } from './model.js';
import { SignIns, authorizeUrl, baseOf, parseRedirect, tokenRequest } from './oauth.js';
import { StatePublisher } from './publisher.js';
import { dayOf, fileStore, normalizeMemory } from './store.js';

/** The stops kept in /data: only the user lifts them. */
const PERSISTED = new Set(['expired', 'unauthorized']);
/** Their status message, and those of the stops that are not kept. */
const STOP_MESSAGES = {
  no_client: T.noClient,
  signed_out: T.signedOut,
  expired: T.expired,
  unauthorized: T.unauthorized,
};
/** The pauses that hold every path (the sign-in, the renewal, the reads). */
const HARD = new Set(['rate', 'unavailable', 'budget']);
/** The errors that pause every path. */
const PAUSING = new Set(['rate_limited', 'unavailable', 'budget']);
/** Errors after which the account counts as unreachable (badge). */
const OFFLINE = new Set(['network', 'timeout', 'unavailable', 'bad_response', 'size', 'http']);
/** The errors that end the whole cycle, even on a secondary collection. */
const CRITICAL = new Set([
  'rate_limited',
  'budget',
  'unauthorized_block',
  'refused',
  'signed_out',
  'renew_wait',
  'paused',
  'stale',
]);
/** The fields of a Gladys feature that a publication carries. */
const FEATURE_FIELDS = [
  'id',
  'name',
  'external_id',
  'category',
  'type',
  'unit',
  'min',
  'max',
  'read_only',
  'has_feedback',
  'keep_history',
];
/** An access token closer than this to its end is not used (renewed first). */
const TOKEN_SLACK = 10 * SECOND;

/** One message in both languages, for an error thrown to Gladys. */
const thrown = (message) => new Error(`${message.en} / ${message.fr}`);

export class OuraApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'oura' }),
    transport = httpsTransport,
    now = Date.now,
    timers = globalThis,
    store = fileStore(),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    // Every request counts in the daily budget; a socket error becomes an OuraError.
    this.transport = async (...args) => {
      this.countRequest();
      try {
        return await transport(...args);
      } catch (err) {
        throw networkError(err);
      }
    };
    this.now = now;
    this.timers = timers;
    this.store = store;
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
    this.signIns = new SignIns({ now });
    this.config = normalizeConfig();
    this.memory = normalizeMemory(null);
    /** Moved on by every sign-in and every start: an answer of before is dropped. */
    this.epoch = 0;
    this.generation = 0;
    this.timer = undefined;
    this.renewTimer = undefined;
    this.running = undefined;
    this.renewing = undefined;
    this.started = false;
    this.lastStatus = undefined;
    this.lastTestAt = -Infinity;
    /** The device published in this run, by external id: a publication never shrinks. */
    this.known = new Map();
    this.reset();
  }

  /** Forgets the account state of this run. A 429, 5xx or budget pause stays. */
  reset() {
    /** The values of the last read (in memory only), and its day of sleep data. */
    this.values = null;
    this.day = null;
    /** The collections not read at the last cycle. */
    this.missing = [];
    this.published = undefined;
    this.badges = new Map();
    /** undefined | 'no_client' | 'signed_out' | 'expired' | 'unauthorized' */
    this.blocked = undefined;
    this.offline = false;
    this.connectedOnce = false;
    this.failures = 0;
    this.renewFailures = 0;
    this.renewRetryAt = 0;
    this.renewError = undefined;
    this.cycleStart = -Infinity;
    if (!HARD.has(this.pauseKind) || this.now() >= this.pausedUntil) {
      this.pausedUntil = 0;
      /** 'rate', 'unavailable', 'budget': every path waits; 'forbidden', 'backoff': the reads. */
      this.pauseKind = undefined;
    }
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}) {
    this.stop();
    // A renewal or an exchange still in flight belongs to the previous keys: dropped.
    this.epoch += 1;
    await this.running;
    const previous = this.config.client;
    this.config = normalizeConfig(raw);
    if (previous && previous !== this.config.client) {
      // Another app: its device and its values are not this one's.
      this.known = new Map();
      this.publisher.clear();
    }
    this.reset();
    this.signIns.clear();
    this.memory = normalizeMemory(await this.store.load().catch(() => null), this.now());
    const pause = this.memory.pause;
    if (pause && pause.until > Math.max(this.now(), this.pausedUntil)) {
      this.pausedUntil = pause.until;
      this.pauseKind = pause.kind;
    }
    this.publisher.start();
    const { client } = this.config;
    if (!client || !this.config.clientSecret) {
      this.blocked = 'no_client';
      await this.setStatus(false, T.noClient);
      return;
    }
    if (this.session || this.memory.block?.client === client) {
      await this.publishDevices();
    }
    if (this.memory.block?.client === client) {
      // A stop on this very client survives a restart (never retried by itself).
      this.blocked = this.memory.block.kind;
      await this.setStatus(false, STOP_MESSAGES[this.blocked]);
      await this.publishBadges();
      return;
    }
    if (!this.session) {
      this.blocked = 'signed_out';
      await this.setStatus(false, T.signedOut);
      return;
    }
    this.scheduleRenew();
    // The first read: not sooner than the interval after the last cycle (kept in
    // /data, never in the future) nor before the end of a pause (capped when read).
    const due = Math.max((this.memory.lastCycleAt ?? -Infinity) + this.interval, this.pausedUntil);
    if (due > this.now()) {
      // The status says when the read comes, never "reading" while it waits.
      // The last cycle succeeded and nothing failed nor paused since: still connected.
      const success = this.memory.lastSuccessAt;
      if (
        this.pausedUntil <= this.now() &&
        success !== null &&
        success >= (this.memory.lastCycleAt ?? -Infinity)
      ) {
        this.connectedOnce = true;
        await this.setStatus(true, join(T.connected, T.nextRead(age(due - this.now()))));
        this.scheduleAt(due);
        return;
      }
      await this.setStatus(false, this.pauseMessage() ?? T.nextRead(age(due - this.now())));
      this.scheduleAt(due);
      return;
    }
    await this.setStatus(false, this.pauseMessage() ?? T.connecting);
    await this.tick();
  }

  stop() {
    this.generation += 1;
    this.clearTimer();
    this.clearRenewTimer();
    this.publisher.stop();
  }

  clearTimer() {
    if (this.timer) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  clearRenewTimer() {
    if (this.renewTimer) {
      this.timers.clearTimeout(this.renewTimer);
      this.renewTimer = undefined;
    }
  }

  /** The session of the configured client, or null. */
  get session() {
    const s = this.memory.session;
    return s && s.client === this.config.client ? s : null;
  }

  /** The keys of a token request. */
  tokenOptions(timeout) {
    return {
      endpoint: this.config.tokenEndpoint,
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      now: this.now(),
      timeout,
    };
  }

  /**
   * Connected to Gladys. The first time, start; after a reconnection (Gladys
   * restarted), resend what Gladys keeps in memory only (status, Discovery
   * list, badge). The pauses, the stops and the session stay; a read is
   * never started by it.
   */
  async connected(raw = {}) {
    if (!this.started) {
      this.started = true;
      await this.start(raw);
      return;
    }
    await this.configUpdated(raw);
    this.published = undefined;
    this.badges = new Map();
    const status = this.lastStatus;
    this.lastStatus = undefined;
    if (status) {
      const [connected, message] = JSON.parse(status);
      await this.setStatus(connected, message ?? undefined);
    }
    await this.publishDevices();
    await this.publishBadges();
  }

  /** A new app restarts; a new interval reschedules; a new language renames. Unchanged: nothing. */
  async configUpdated(raw = {}) {
    const next = normalizeConfig(raw);
    const previous = this.config;
    if (next.client !== previous.client || next.clientSecret !== previous.clientSecret) {
      return this.start(raw);
    }
    this.config = next;
    if (next.pollMinutes !== previous.pollMinutes && this.timer) {
      // Never sooner than the new interval after the last cycle.
      const due = Math.max(
        (this.memory.lastCycleAt ?? -Infinity) + this.interval,
        this.pausedUntil,
        this.renewRetryAt,
      );
      this.scheduleAt(Math.max(due, this.now()));
    }
    if (next.language !== previous.language) {
      this.published = undefined;
      this.known = new Map();
      await this.publishDevices();
      this.queueStates();
      await this.flush();
    }
    return undefined;
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  get lastMessage() {
    return JSON.parse(this.lastStatus ?? '[false,null]')[1] ?? undefined;
  }

  async saveMemory() {
    await this.store
      .save(this.memory)
      .catch((err) => this.logger.warn(`Saving the state to /data failed: ${err.message}`));
  }

  async flush() {
    await this.publisher
      .flush()
      .catch((err) => this.logger.warn(`Sending to Gladys failed: ${err.message}`));
  }

  /** The read interval: the configured one (15 minutes at least). */
  get interval() {
    return this.config.pollMinutes * MINUTE;
  }

  /** One more request today; refused once the daily budget is spent. */
  countRequest() {
    const day = dayOf(this.now());
    if (this.memory.requests.day !== day) {
      this.memory.requests = { day, count: 0 };
    }
    if (this.memory.requests.count >= LIMITS.dailyRequests) {
      throw new OuraError('budget', 'daily number of requests reached');
    }
    this.memory.requests.count += 1;
  }

  // --- Pauses and stops ----------------------------------------------------------

  /** A 429, a 5xx, a 403 or the daily budget: a pause kept in /data. Returns its length. */
  async pause(err) {
    let wait;
    if (err.kind === 'rate_limited') {
      wait = Math.min(
        TIMINGS.rateLimitMax,
        Math.max(TIMINGS.rateLimitMin, err.retryAfter ?? TIMINGS.rateLimitDefault),
      );
      this.pauseKind = 'rate';
    } else if (err.kind === 'budget') {
      // Until the next UTC day, plus a minute.
      wait = (dayOf(this.now()) + 1) * DAY - this.now() + MINUTE;
      this.pauseKind = 'budget';
    } else if (err.kind === 'forbidden') {
      wait = Math.max(this.interval, TIMINGS.forbidden);
      this.pauseKind = 'forbidden';
    } else {
      const step = TIMINGS.unavailable[Math.min(this.failures, TIMINGS.unavailable.length - 1)];
      wait = Math.max(this.interval, step);
      this.pauseKind = 'unavailable';
      this.offline = true;
    }
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + wait);
    this.memory.pause = { kind: this.pauseKind, until: this.pausedUntil };
    this.memory.lastSuccessAt = null;
    await this.saveMemory();
    return this.pausedUntil - this.now();
  }

  /** The message of a pause still running. */
  pauseMessage() {
    const left = this.pausedUntil - this.now();
    if (left <= 0) {
      return undefined;
    }
    switch (this.pauseKind) {
      case 'rate':
        return T.rateLimited(age(left));
      case 'unavailable':
        return T.unavailable(age(left));
      case 'budget':
        return T.budget(age(left));
      case 'forbidden':
        return T.forbidden(age(left));
      default:
        return undefined;
    }
  }

  get hardPaused() {
    return HARD.has(this.pauseKind) && this.now() < this.pausedUntil;
  }

  /** A stop only the user lifts: kept in /data with its client. */
  async block(kind) {
    this.blocked = kind;
    this.memory.lastSuccessAt = null;
    this.clearTimer();
    if (kind === 'expired') {
      // The renewal token is useless now: a new authorization replaces it.
      this.memory.session = null;
      this.clearRenewTimer();
    }
    if (PERSISTED.has(kind)) {
      this.memory.block = { kind, client: this.config.client };
    }
    await this.saveMemory();
    this.logger.warn(`Oura stopped: ${kind}`);
    await this.setStatus(false, STOP_MESSAGES[kind]);
    await this.publishBadges();
  }

  // --- Token renewal ----------------------------------------------------------

  /**
   * The renewal timer: at the end of the token minus a margin (10 minutes, at
   * most half of its lifetime), never within a minute of the last renewal,
   * nor during a hard pause, nor before the next try after a failure.
   */
  scheduleRenew() {
    this.clearRenewTimer();
    const s = this.session;
    if (!s || PERSISTED.has(this.blocked)) {
      return;
    }
    const lifetime = Math.max(0, s.expiresAt - s.obtainedAt);
    const margin = Math.min(TIMINGS.tokenMargin, lifetime / 2);
    let at = Math.max(
      s.expiresAt - margin,
      (this.memory.lastRenewAt ?? -Infinity) + TIMINGS.renewFloor,
      this.renewRetryAt,
    );
    if (this.hardPaused) {
      at = Math.max(at, this.pausedUntil);
    }
    const generation = this.generation;
    this.renewTimer = this.timers.setTimeout(
      () => {
        this.renewTimer = undefined;
        if (generation !== this.generation) {
          return;
        }
        this.renew().catch((err) => this.renewFailed(err, generation));
      },
      Math.max(0, at - this.now()),
    );
  }

  /** A renewal of the timer failed: a pause, a later try, or a stop (refused). */
  async renewFailed(err, generation) {
    if (generation !== this.generation || this.blocked) {
      return;
    }
    this.logger.info(`Oura: token renewal failed (${errorReason(err)})`);
    if (PAUSING.has(err.kind)) {
      await this.pause(err);
      await this.setStatus(this.connectedOnce && err.kind !== 'unavailable', this.pauseMessage());
    } else if (err.kind === 'renew_wait' || err.kind === 'paused') {
      // A renewal ran less than a minute ago, or a pause runs: the timer comes back after it.
    } else if (this.session && this.now() >= this.session.expiresAt) {
      await this.setStatus(
        false,
        T.renewWaiting(errorReason(err), age(this.renewRetryAt - this.now())),
      );
    }
    this.scheduleRenew();
  }

  /** One renewal at a time: a second call joins the one in flight (never two in parallel). */
  renew(timeout) {
    if (!this.renewing) {
      this.renewing = this.doRenew(timeout).finally(() => {
        this.renewing = undefined;
      });
    }
    return this.renewing;
  }

  async doRenew(timeout = TIMINGS.requestTimeout) {
    const s = this.session;
    if (!s || this.blocked) {
      throw new OuraError('signed_out', 'not signed in to Oura');
    }
    const now = this.now();
    if (now < (this.memory.lastRenewAt ?? -Infinity) + TIMINGS.renewFloor) {
      throw new OuraError('renew_wait', 'renewed less than a minute ago');
    }
    if (this.hardPaused) {
      // Nothing sent: the pause already running is neither extended nor restarted.
      throw new OuraError('paused', 'paused');
    }
    const epoch = this.epoch;
    // Kept before the request: a restart during it never renews within a minute.
    this.memory.lastRenewAt = now;
    await this.saveMemory();
    let token;
    try {
      token = await tokenRequest(
        this.transport,
        { grant_type: 'refresh_token', refresh_token: s.refreshToken },
        this.tokenOptions(timeout),
      );
    } catch (err) {
      if (epoch !== this.epoch) {
        // A sign-in or a restart happened meanwhile: this failure belongs to the old session.
        throw new OuraError('renew_wait', 'a new sign-in replaced the session');
      }
      if (err.kind === 'refused') {
        // Never tried again by itself: only a new authorization clears it.
        await this.block('expired');
      } else if (!PAUSING.has(err.kind)) {
        this.renewRetryAt =
          this.now() +
          TIMINGS.renewRetry[Math.min(this.renewFailures, TIMINGS.renewRetry.length - 1)];
        this.renewFailures += 1;
        this.renewError = err;
      }
      throw err;
    }
    if (epoch !== this.epoch) {
      return;
    }
    // Oura's renewal tokens serve once: the new one is kept at once.
    this.memory.session = {
      client: this.config.client,
      ...token,
      refreshToken: token.refreshToken ?? s.refreshToken,
    };
    this.renewFailures = 0;
    this.renewRetryAt = 0;
    this.renewError = undefined;
    await this.saveMemory();
    this.scheduleRenew();
  }

  /** A usable access token: renewed first when it ended (and a renewal is allowed). */
  async accessToken(timeout) {
    const s = this.session;
    if (!s) {
      throw new OuraError('signed_out', 'not signed in to Oura');
    }
    if (s.accessToken && this.now() < s.expiresAt - TOKEN_SLACK) {
      return s.accessToken;
    }
    if (this.now() < this.renewRetryAt) {
      throw new OuraError(
        'renew_wait',
        this.renewError ? errorReason(this.renewError) : 'renewal failed',
      );
    }
    await this.renew(timeout);
    const fresh = this.session;
    if (!fresh?.accessToken) {
      throw new OuraError('signed_out', 'not signed in to Oura');
    }
    return fresh.accessToken;
  }

  /**
   * An API call. On the primary collection, a refused token renews once
   * (when a renewal is allowed) and tries again; refused again with a token
   * of this cycle: a stop. On a secondary collection (read after the primary
   * succeeded with the same token), a 401 or a 403 is a scope not granted or
   * a feature absent: that collection only is left out.
   */
  async call(fn, timeout, { secondary = false } = {}) {
    let token = await this.accessToken(timeout);
    try {
      return await fn(token);
    } catch (err) {
      if (secondary && (err.kind === 'unauthorized' || err.kind === 'forbidden')) {
        throw new OuraError('scope', 'not granted or not available', { status: err.status });
      }
      if (err.kind !== 'unauthorized') {
        throw err;
      }
      const current = this.session?.accessToken;
      if (current && current !== token) {
        // Renewed by the timer meanwhile: tried once more with the new token.
        token = current;
      } else {
        if ((this.session?.obtainedAt ?? 0) >= this.cycleStart) {
          throw new OuraError('unauthorized_block', 'Oura refused a new access token');
        }
        if (this.now() < this.renewRetryAt) {
          throw new OuraError(
            'renew_wait',
            this.renewError ? errorReason(this.renewError) : 'renewal failed',
          );
        }
        // Expired early: renewed now (the floor of a minute still holds).
        await this.renew(timeout);
        token = this.session?.accessToken;
        if (!token) {
          throw err;
        }
      }
    }
    try {
      return await fn(token);
    } catch (err) {
      if (err.kind === 'unauthorized') {
        throw new OuraError('unauthorized_block', 'Oura refused a new access token');
      }
      throw err;
    }
  }

  // --- Polling ---------------------------------------------------------------

  /** Read again after the interval, or at the end of a pause. */
  scheduleNext() {
    this.clearTimer();
    if (this.blocked) {
      return;
    }
    const now = this.now();
    this.scheduleAt(now + Math.max(this.interval, this.pausedUntil - now, this.renewRetryAt - now));
  }

  /** The next read at `at`. */
  scheduleAt(at) {
    this.clearTimer();
    const delay = at - this.now();
    const generation = this.generation;
    this.timer = this.timers.setTimeout(
      () => {
        this.timer = undefined;
        if (generation === this.generation) {
          this.tick().catch((err) => this.logger.error(`Oura refresh failed: ${err.message}`));
        }
      },
      Math.max(0, delay),
    );
  }

  /** One run at a time: a tick during a run joins it. `quick`: for a button. */
  tick({ quick = false } = {}) {
    if (!this.running) {
      this.running = this.run({ quick }).finally(() => {
        this.running = undefined;
      });
    }
    return this.running;
  }

  async run({ quick = false } = {}) {
    const generation = this.generation;
    if (this.blocked) {
      return;
    }
    if (this.now() < this.pausedUntil) {
      this.scheduleNext();
      return;
    }
    const timeout = quick ? TIMINGS.quickTimeout : TIMINGS.requestTimeout;
    this.cycleStart = this.now();
    // Kept in /data before the first request: a restart never reads sooner than the interval.
    this.memory.lastCycleAt = this.cycleStart;
    await this.saveMemory();
    if (generation !== this.generation) {
      return;
    }
    try {
      const read = await this.readAll(timeout, generation);
      if (generation !== this.generation || read === null) {
        return;
      }
      this.values = read.values;
      this.day = read.day;
      this.missing = read.missing;
      // A stop raised meanwhile (a refused renewal by the timer) is never covered.
      if (!this.blocked) {
        await this.succeeded();
      }
    } catch (err) {
      if (generation !== this.generation || err.kind === 'stale') {
        return;
      }
      await this.failed(err);
    }
    if (generation !== this.generation) {
      return;
    }
    await this.saveMemory();
    await this.publishDevices();
    this.queueStates();
    await this.flush();
    await this.publishBadges();
    this.scheduleNext();
  }

  /**
   * The collections of a cycle: the primary first (its failure is the
   * cycle's), then the secondary ones, each left out alone on its own
   * refusal, 5xx or timeout. A 429 or the daily budget ends the cycle. The
   * answers stay local: nothing is kept nor published when the generation
   * changed meanwhile (null).
   */
  async readAll(timeout, generation) {
    const answers = {};
    const missing = [];
    for (const name of COLLECTIONS) {
      const secondary = name !== PRIMARY;
      try {
        answers[name] =
          name === 'heartrate'
            ? await this.readHeartRate(timeout, generation)
            : await this.call(
                (token) =>
                  getCollection(
                    this.transport,
                    name,
                    queryOf(name, this.now(), TIMINGS.heartRateWindow),
                    {
                      token,
                      now: this.now(),
                      timeout,
                    },
                  ),
                timeout,
                { secondary },
              );
      } catch (err) {
        if (generation !== this.generation) {
          return null;
        }
        if (!secondary || CRITICAL.has(err.kind)) {
          throw err;
        }
        missing.push(name);
        // The reason only: never a value.
        this.logger.info(`Oura: ${name} not read (${errorReason(err)})`);
        continue;
      }
      if (generation !== this.generation) {
        return null;
      }
    }
    const { day, values } = valuesOf(answers, this.now());
    return { day, values, missing };
  }

  /** The heart rate of the last hours: the pages of the answer, LIMITS.heartRatePages at most. */
  async readHeartRate(timeout, generation) {
    const pages = [];
    let query = queryOf('heartrate', this.now(), TIMINGS.heartRateWindow);
    for (let i = 0; i < LIMITS.heartRatePages; i += 1) {
      const page = await this.call(
        (token) =>
          getCollection(this.transport, 'heartrate', query, { token, now: this.now(), timeout }),
        timeout,
        { secondary: true },
      );
      if (generation !== this.generation) {
        throw new OuraError('stale', 'stale');
      }
      pages.push(page);
      const next = typeof page.next_token === 'string' ? page.next_token : '';
      if (!next || next.length > 2048) {
        break;
      }
      query = { next_token: next };
    }
    return pages;
  }

  async succeeded() {
    this.failures = 0;
    this.offline = false;
    this.connectedOnce = true;
    this.pauseKind = undefined;
    this.pausedUntil = 0;
    // Kept in /data: a restart before the next read stays connected (cleared by any failure).
    this.memory.lastSuccessAt = this.cycleStart;
    this.memory.pause = null;
    await this.setStatus(true, this.okMessage());
  }

  /** The status of a good read: recent data or not, the collections not read. */
  okMessage() {
    let message = this.day === null ? T.noRecentData : T.connected;
    if (this.missing.length > 0) {
      message = join(message, T.partial(this.missing.map((n) => COLLECTION_NAMES[n])));
    }
    return message;
  }

  async failed(err) {
    const reason = errorReason(err);
    this.memory.lastSuccessAt = null;
    switch (err.kind) {
      case 'signed_out':
        if (!this.blocked) {
          this.blocked = 'signed_out';
          await this.setStatus(false, T.signedOut);
        }
        return;
      case 'refused':
        // The renewal was refused: block('expired') already ran.
        return;
      case 'unauthorized_block':
        await this.block('unauthorized');
        return;
      case 'paused':
        // A hard pause already runs: kept as it is.
        return;
      default:
        break;
    }
    if (this.blocked) {
      // A stop raised meanwhile keeps its message.
      return;
    }
    let message;
    if (PAUSING.has(err.kind) || err.kind === 'forbidden') {
      await this.pause(err);
      message = this.pauseMessage();
    } else if (err.kind === 'renew_wait') {
      // The token could not be renewed yet: the reads wait for the renewal.
      const wait = Math.max(this.interval, this.renewRetryAt - this.now());
      this.pauseKind = 'backoff';
      this.pausedUntil = Math.max(this.pausedUntil, this.now() + wait);
      message = T.renewWaiting(reason, age(wait));
    } else {
      // Never read again sooner than the interval.
      const wait = Math.max(
        this.interval,
        TIMINGS.backoff[Math.min(this.failures, TIMINGS.backoff.length - 1)],
      );
      this.pauseKind = 'backoff';
      this.offline = OFFLINE.has(err.kind) || this.offline;
      this.pausedUntil = Math.max(this.pausedUntil, this.now() + wait);
      message = T.unreachable(reason, age(wait));
    }
    if (this.pauseKind === 'backoff') {
      // Kept in /data (capped): a restart does not read sooner either.
      this.memory.pause = {
        kind: 'backoff',
        until: Math.min(this.pausedUntil, this.now() + TIMINGS.backoffMax),
      };
    }
    this.failures += 1;
    const connected =
      !['unavailable', 'forbidden'].includes(err.kind) &&
      this.pauseKind !== 'backoff' &&
      this.connectedOnce;
    await this.setStatus(connected, message);
    this.logger.warn(`Oura: ${reason}; next try in ${Math.round(this.interval / 1000)} s or later`);
  }

  // --- Gladys ----------------------------------------------------------------

  createdDevices() {
    return new Map((this.gladys.devices ?? []).map((d) => [d.external_id, d]));
  }

  createdFeatures() {
    return new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  /**
   * The device of the Oura app, merged so that nothing ever disappears: a
   * created device keeps its features as Gladys has them (types and units
   * are fixed at creation), plus any new one; a feature seen earlier in this
   * run stays published.
   */
  async publishDevices() {
    const { client } = this.config;
    if (!client) {
      return;
    }
    const fresh = buildDevice(this.gladys, client, this.config.language);
    const previous = this.known.get(fresh.external_id);
    const mine = this.createdDevices().get(fresh.external_id);
    const features = new Map();
    for (const f of mine?.features ?? []) {
      if (typeof f?.external_id !== 'string') {
        continue;
      }
      features.set(
        f.external_id,
        Object.fromEntries(
          FEATURE_FIELDS.filter((k) => f[k] !== undefined && f[k] !== null).map((k) => [k, f[k]]),
        ),
      );
    }
    for (const f of [...(previous?.features ?? []), ...fresh.features]) {
      if (!features.has(f.external_id)) {
        features.set(f.external_id, f);
      }
    }
    this.known.set(fresh.external_id, { ...fresh, features: [...features.values()] });
    const list = [...this.known.values()];
    const json = JSON.stringify(list);
    if (json === this.published) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(list);
      this.published = json;
    } catch (err) {
      this.logger.warn(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  /** The states of the last read, for the created features only. */
  queueStates(created = this.createdFeatures()) {
    if (!this.values || !this.config.client) {
      return;
    }
    for (const [featureId, value] of deviceStates(this.gladys, this.config.client, this.values)) {
      if (created.has(featureId)) {
        this.publisher.push(featureId, { state: value });
      }
    }
  }

  /** The badge of the created device: cloud, or unreachable (stopped, offline). */
  async publishBadges() {
    if (!this.config.client) {
      return;
    }
    const id = deviceIds(this.gladys, this.config.client).device;
    if (!this.createdDevices().has(id)) {
      return;
    }
    const unreachable = Boolean(this.blocked) || this.offline || !this.connectedOnce;
    const transport = unreachable ? DEVICE_TRANSPORTS.UNREACHABLE : DEVICE_TRANSPORTS.CLOUD;
    if (this.badges.get(id) === transport) {
      return;
    }
    try {
      await this.gladys.publishTransports([{ external_id: id, transport }]);
      this.badges.set(id, transport);
    } catch (err) {
      this.logger.warn(`Transport badge failed: ${err.message}`);
    }
  }

  /** A device created or updated: the values of the last read right away. */
  async deviceCreated(device) {
    await this.deviceUpdated(device);
  }

  async deviceUpdated(device) {
    if (device?.external_id) {
      this.badges.delete(device.external_id);
    }
    const created = this.createdFeatures();
    for (const f of device?.features ?? []) {
      created.add(f?.external_id);
    }
    this.queueStates(created);
    await this.flush();
    await this.publishBadges();
  }

  async deviceDeleted(device) {
    if (device?.external_id) {
      this.badges.delete(device.external_id);
      this.publisher.forget(device.external_id);
    }
  }

  /** The Discovery tab asks for a scan: the device known now, never a read. */
  async scan() {
    this.published = undefined;
    await this.publishDevices();
  }

  // --- Sign-in -----------------------------------------------------------------

  /** The Connect button: the Oura authorization address (a new state). */
  async oauthAuthorizeUrl(_key, redirectUri) {
    if (!this.config.client || !this.config.clientSecret) {
      throw thrown(T.noClient);
    }
    if (this.hardPaused) {
      throw thrown(this.pauseMessage());
    }
    const redirect = this.config.redirectUri || redirectUri;
    if (!redirect) {
      throw thrown(T.signIn.noRedirect);
    }
    if (this.blocked && !this.config.redirectUri) {
      // Not connected: the status shows the return address to register in the app.
      await this.setStatus(
        false,
        join(STOP_MESSAGES[this.blocked] ?? T.signedOut, T.signIn.redirectHint(baseOf(redirect))),
      );
    }
    const state = this.signIns.begin({ redirectUri: redirect });
    return authorizeUrl({ clientId: this.config.clientId, redirectUri: redirect, state });
  }

  /** Oura redirected to Gladys: the code of an authorization started here. */
  async oauthCallback(_key, { code, state } = {}) {
    if (typeof code !== 'string' || !code || code.length > LIMITS.codeLength) {
      throw thrown(T.signIn.noCode);
    }
    // The state serves once; a missing one never matches an authorization.
    const signIn = typeof state === 'string' && state ? this.signIns.take(state) : null;
    if (!signIn) {
      throw thrown(T.signIn.unknown);
    }
    // Gladys waits for this answer: the exchange must end well before its timeout.
    const result = await this.exchange(code, signIn, { timeout: TIMINGS.callbackTimeout });
    if (result !== T.signIn.done) {
      throw thrown(result);
    }
  }

  /** The address pasted by the user (redirect URI other than Gladys'). */
  async finishSignIn(fields) {
    const parsed = parseRedirect(fields?.url);
    if (!parsed) {
      return T.signIn.noCode;
    }
    if (parsed.error) {
      // Only a safe code: a text of the pasted address is never shown back.
      return T.signIn.cancelled(safeCode(parsed.error) ?? 'error');
    }
    // The state ties the address to an authorization started here: never guessed.
    if (!parsed.state || !parsed.code) {
      return T.signIn.noCode;
    }
    const pending = this.signIns.peek(parsed.state);
    if (!pending) {
      return T.signIn.unknown;
    }
    // A whole address must be the redirect URI of that authorization (left unused otherwise).
    if (parsed.base !== null && parsed.base !== baseOf(pending.redirectUri)) {
      return T.signIn.wrongAddress;
    }
    const signIn = this.signIns.take(parsed.state);
    if (!signIn) {
      return T.signIn.unknown;
    }
    return this.exchange(parsed.code, signIn, { timeout: TIMINGS.quickTimeout, pasted: true });
  }

  /** The code -> a new session, kept in /data; then one read. */
  async exchange(code, signIn, { timeout = TIMINGS.quickTimeout, pasted = false } = {}) {
    if (!this.config.client || !this.config.clientSecret) {
      return T.noClient;
    }
    if (this.hardPaused) {
      this.signIns.restore(signIn);
      return this.pauseMessage();
    }
    // New keys saved during the exchange (a restart) drop its answer.
    const epoch = this.epoch;
    const client = this.config.client;
    let token;
    try {
      token = await tokenRequest(
        this.transport,
        {
          grant_type: 'authorization_code',
          code,
          redirect_uri: signIn.entry.redirectUri,
        },
        this.tokenOptions(timeout),
      );
    } catch (err) {
      this.logger.warn(`Oura authorization failed: ${errorReason(err)}`);
      if (err.kind === 'timeout') {
        // The code may have been used by Oura meanwhile: a new authorization is the safe way.
        return T.signIn.slow;
      }
      if (err.kind === 'refused') {
        return T.signIn.refused(err.detail ?? 'HTTP 400');
      }
      if (PAUSING.has(err.kind)) {
        await this.pause(err);
        this.signIns.restore(signIn);
        return this.pauseMessage();
      }
      if (!pasted) {
        // Gladys' return cannot be replayed: only a new click on Connect helps.
        return T.signIn.retryConnect(errorReason(err));
      }
      // Oura was not reached: the same address can be pasted again.
      this.signIns.restore(signIn);
      return T.signIn.failed(errorReason(err));
    }
    if (epoch !== this.epoch || client !== this.config.client) {
      return T.signIn.unknown;
    }
    if (!token.refreshToken) {
      return T.signIn.noRefresh;
    }
    // A renewal still running with the previous session must not overwrite this one.
    this.epoch += 1;
    this.memory.session = { client: this.config.client, ...token };
    this.memory.block = null;
    this.blocked = undefined;
    this.failures = 0;
    this.renewFailures = 0;
    this.renewRetryAt = 0;
    this.renewError = undefined;
    if (this.pauseKind === 'backoff' || this.pauseKind === 'forbidden') {
      this.pausedUntil = 0;
      this.pauseKind = undefined;
      this.memory.pause = null;
    }
    await this.saveMemory();
    this.logger.info('Oura: authorized');
    this.scheduleRenew();
    await this.publishDevices();
    // One read now, unless one ran less than the interval ago (then at its time).
    const due = (this.memory.lastCycleAt ?? -Infinity) + this.interval;
    if (due > this.now()) {
      await this.setStatus(false, T.nextRead(age(due - this.now())));
      this.scheduleAt(due);
    } else {
      await this.setStatus(false, T.connecting);
      this.tick({ quick: true }).catch((err) =>
        this.logger.error(`Oura refresh failed: ${err.message}`),
      );
    }
    return T.signIn.done;
  }

  // --- Configuration buttons ----------------------------------------------------

  async testConnection() {
    if (!this.config.client || !this.config.clientSecret) {
      return T.noClient;
    }
    if (this.blocked === 'signed_out' || this.blocked === 'expired') {
      return STOP_MESSAGES[this.blocked];
    }
    const paused = this.pauseMessage();
    if (paused) {
      return paused;
    }
    if (this.now() - this.lastTestAt < TIMINGS.testCooldown) {
      const last = this.lastMessage;
      return last ? join(T.test.cooldown, last) : T.test.cooldown;
    }
    if (this.running) {
      return T.busy;
    }
    if (this.blocked === 'unauthorized') {
      // One read per click: the button is how a refused access is tried again,
      // still never sooner than the interval after the last cycle.
      const due = (this.memory.lastCycleAt ?? -Infinity) + this.interval;
      if (due > this.now()) {
        return join(T.unauthorized, T.nextRead(age(due - this.now())));
      }
      this.lastTestAt = this.now();
      this.blocked = undefined;
      this.memory.block = null;
      if (this.pauseKind === 'backoff') {
        this.pausedUntil = 0;
        this.pauseKind = undefined;
        this.memory.pause = null;
      }
      await this.saveMemory();
      this.scheduleRenew();
      await this.tick({ quick: true });
      return this.lastMessage ?? T.signedOut;
    }
    // Otherwise never sooner than the interval, nor during an error pause:
    // the last result and when the next read comes.
    const due = Math.max(
      (this.memory.lastCycleAt ?? -Infinity) + this.interval,
      this.pausedUntil,
      this.renewRetryAt,
    );
    if (due > this.now()) {
      const next = T.nextRead(age(due - this.now()));
      const last = this.lastMessage;
      return last ? join(last, next) : next;
    }
    this.lastTestAt = this.now();
    await this.tick({ quick: true });
    return this.lastMessage ?? T.signedOut;
  }
}
