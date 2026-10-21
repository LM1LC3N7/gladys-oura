// -----------------------------------------------------------------------------
// What goes to Gladys, within its limit of 300 states per minute. push()
// keeps the current reading of a feature (the last one wins) with its key
// (value@day, bpm@timestamp, as gladys-dexcom): a reading whose key was
// already sent is never sent again (no heartbeat: Gladys would date an old
// value as new), and a reading past its `until` is dropped before sending.
// One flush at a time, so the budget of the minute holds even when several
// publications start together; the states are counted before the request.
// What is left over (budget spent, Gladys unreachable) waits for the next
// flush, every second.
// -----------------------------------------------------------------------------

import { LIMITS, MINUTE, TIMINGS } from './constants.js';

export class StatePublisher {
  constructor({ gladys, logger, now = Date.now, timers = globalThis }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    /** featureId -> { state, created_at?, key, until } */
    this.pending = new Map();
    /** featureId -> the key last sent. */
    this.sent = new Map();
    this.window = [];
    this.timer = undefined;
    this.flushing = undefined;
  }

  start() {
    this.stop();
    this.timer = this.timers.setInterval(() => {
      this.flush().catch((err) => this.logger.warn(`Sending to Gladys failed: ${err.message}`));
    }, TIMINGS.flushInterval);
  }

  stop() {
    if (this.timer) {
      this.timers.clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** A reading of a feature: queued unless already sent or no longer current. */
  push(featureId, { value, key, until, createdAt }) {
    if (this.sent.get(featureId) === key || this.now() >= until) {
      // What Gladys holds (or is being sent) is this reading: an older one
      // still waiting must not replace it once Gladys is back.
      this.pending.delete(featureId);
      return;
    }
    this.pending.set(featureId, {
      state: value,
      ...(createdAt ? { created_at: createdAt } : {}),
      key,
      until,
    });
  }

  /** Forgets what is pending and what was sent for a device (Gladys forgot it, or it is new). */
  forget(deviceId) {
    for (const map of [this.pending, this.sent]) {
      for (const id of [...map.keys()]) {
        if (id === deviceId || id.startsWith(`${deviceId}:`)) {
          map.delete(id);
        }
      }
    }
  }

  /** Forgets everything (new keys: the values of the previous app). */
  clear() {
    this.pending.clear();
    this.sent.clear();
  }

  flush() {
    if (!this.flushing) {
      this.flushing = this.doFlush().finally(() => {
        this.flushing = undefined;
      });
    }
    return this.flushing;
  }

  async doFlush() {
    const now = this.now();
    this.window = this.window.filter((t) => now - t < MINUTE);
    const room = Math.min(LIMITS.statesPerMinute - this.window.length, LIMITS.statesPerRequest);
    if (room <= 0 || this.pending.size === 0) {
      return;
    }
    const batch = [];
    for (const [featureId, entry] of this.pending) {
      if (batch.length >= room) {
        break;
      }
      this.pending.delete(featureId);
      if (now >= entry.until) {
        // Waited too long (Gladys unreachable): no longer current.
        continue;
      }
      batch.push([featureId, entry]);
    }
    if (batch.length === 0) {
      return;
    }
    for (let i = 0; i < batch.length; i += 1) {
      this.window.push(now);
    }
    // The keys count as sent from the request on (as the SDK does): a reading
    // pushed again meanwhile is not sent twice; the previous key comes back on
    // a failure.
    const previous = new Map(batch.map(([id]) => [id, this.sent.get(id)]));
    for (const [id, entry] of batch) {
      this.sent.set(id, entry.key);
    }
    try {
      await this.gladys.publishStates(
        batch.map(([id, { state, created_at: createdAt }]) => ({
          device_feature_external_id: id,
          state,
          ...(createdAt ? { created_at: createdAt } : {}),
        })),
      );
    } catch (err) {
      // Kept for the next round, unless a newer reading arrived meanwhile.
      for (const [id, entry] of batch) {
        if (this.sent.get(id) === entry.key) {
          if (previous.get(id) === undefined) {
            this.sent.delete(id);
          } else {
            this.sent.set(id, previous.get(id));
          }
        }
        if (!this.pending.has(id)) {
          this.pending.set(id, entry);
        }
      }
      throw err;
    }
  }
}
