// -----------------------------------------------------------------------------
// The pure parts: answers -> values, the choice of the records, the pasted
// address, the errors by status, the JSON reading.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { queryOf } from '../src/api.js';
import { normalizeConfig } from '../src/config.js';
import { FEATURES, buildDevice, deviceStates } from '../src/devices.js';
import { apiError, parseJson } from '../src/http.js';
import { latestDaily, latestHeartRate, mainSleep, valuesOf } from '../src/model.js';
import { parseRedirect } from '../src/oauth.js';
import { normalizeMemory } from '../src/store.js';
import { DAY, HOUR, MINUTE, NOW, collections } from './fixtures/oura.js';

const wrap = (list) => ({ data: list });

test('the latest recent daily record; older days and garbage are left out', () => {
  assert.equal(
    latestDaily(
      wrap([
        { day: '2026-10-20', score: 1 },
        { day: '2026-10-21', score: 2 },
      ]),
      NOW,
    ).score,
    2,
  );
  assert.equal(latestDaily(wrap([{ day: '2026-10-19', score: 1 }]), NOW), null, 'two days old');
  assert.equal(latestDaily(wrap([{ day: '2026-10-25', score: 1 }]), NOW), null, 'in the future');
  assert.equal(latestDaily(wrap([null, 'x', [], { day: 20261021 }]), NOW), null);
  assert.equal(latestDaily({ data: 'nope' }, NOW), null);
  assert.equal(latestDaily(undefined, NOW), null);
});

test('the main sleep: completed periods of the latest day, the long sleep before a longer nap', () => {
  const base = { day: '2026-10-21', bedtime_start: 'a', bedtime_end: 'b' };
  const chosen = mainSleep(
    wrap([
      { ...base, type: 'late_nap', total_sleep_duration: 30000, id: 'nap' },
      { ...base, type: 'long_sleep', total_sleep_duration: 20000, id: 'main' },
      { ...base, day: '2026-10-20', type: 'long_sleep', total_sleep_duration: 29000, id: 'old' },
      { ...base, bedtime_end: null, type: 'long_sleep', total_sleep_duration: 1, id: 'running' },
    ]),
    NOW,
  );
  assert.equal(chosen.id, 'main');
  assert.equal(mainSleep(wrap([{ ...base, bedtime_end: null }]), NOW), null);
});

test('the heart rate: the latest sample within 3 hours, bounded', () => {
  const at = (ms) => new Date(NOW - ms).toISOString();
  const pages = [
    wrap([
      { bpm: 60, timestamp: at(2 * HOUR) },
      { bpm: 72, timestamp: at(5 * MINUTE) },
      { bpm: 400, timestamp: at(MINUTE) },
      { bpm: 65, timestamp: 'nope' },
    ]),
    wrap([{ bpm: 50, timestamp: at(4 * HOUR) }]),
  ];
  assert.deepEqual(latestHeartRate(pages, NOW), { bpm: 72, at: NOW - 5 * MINUTE });
  assert.equal(latestHeartRate([wrap([{ bpm: 50, timestamp: at(4 * HOUR) }])], NOW), null);
});

test('values: never NaN, never a string, never 0 for an absent value', () => {
  const answers = Object.fromEntries(
    Object.entries(collections(NOW)).map(([name, list]) => [
      name,
      name === 'heartrate' ? [wrap(list)] : wrap(list),
    ]),
  );
  const { values, day } = valuesOf(answers, NOW);
  assert.equal(day, '2026-10-21');
  assert.equal(values.sleep_duration, 7.25);
  const empty = valuesOf({}, NOW);
  assert.equal(empty.day, null);
  assert.ok(Object.values(empty.values).every((v) => v === null));
  const odd = valuesOf(
    {
      daily_sleep: wrap([{ day: '2026-10-21', score: '83' }]),
      daily_activity: wrap([{ day: '2026-10-21', steps: NaN, active_calories: -5 }]),
    },
    NOW,
  );
  assert.equal(odd.values.sleep_score, null);
  assert.equal(odd.values.steps, null);
  assert.equal(odd.values.active_calories, null);
});

test('the queries: three days around now, the heart rate of the window', () => {
  assert.deepEqual(queryOf('daily_sleep', NOW), {
    start_date: '2026-10-19',
    end_date: '2026-10-22',
  });
  assert.deepEqual(queryOf('heartrate', NOW, 3 * HOUR), {
    start_datetime: '2026-10-21T05:00:00Z',
    end_datetime: '2026-10-21T08:00:00Z',
  });
});

test('the device: units of the core only, read only, no history; states within bounds', () => {
  const gladys = createFakeGladys({ config: {} });
  const device = buildDevice(gladys, '0123456789abcdef', 'fr');
  const allowed = { duration: ['hours'], unknown: [undefined] };
  for (const f of device.features) {
    assert.ok(allowed[f.category]?.includes(f.unit), `${f.external_id}: ${f.category}/${f.unit}`);
    assert.equal(f.read_only, true);
    assert.equal(f.keep_history, false);
  }
  assert.equal(device.features.length, Object.keys(FEATURES).length);
  const states = deviceStates(gladys, '0123456789abcdef', {
    sleep_score: 101,
    steps: 10,
    spo2: null,
    heart_rate: undefined,
  });
  assert.deepEqual(
    states.map(([id]) => id.split(':').at(-1)),
    ['steps'],
  );
});

test('a pasted address: only code, state, error and its base are read', () => {
  assert.deepEqual(parseRedirect('https://x.example/cb?code=abc&state=s1'), {
    code: 'abc',
    state: 's1',
    error: null,
    base: 'https://x.example/cb',
  });
  assert.equal(parseRedirect('?code=abc&state=s1').base, null);
  assert.equal(parseRedirect('hello'), null);
  assert.equal(parseRedirect(`https://x.example/cb?code=${'a'.repeat(5000)}&state=s`), null);
});

test('errors by status; JSON without prototype pollution', () => {
  assert.equal(apiError({ status: 401, headers: {} }).kind, 'unauthorized');
  assert.equal(apiError({ status: 403, headers: {} }).kind, 'forbidden');
  assert.equal(apiError({ status: 429, headers: { 'retry-after': '30' } }).retryAfter, 30000);
  assert.equal(apiError({ status: 503, headers: {} }).kind, 'unavailable');
  assert.equal(apiError({ status: 200, headers: {} }), undefined);
  const parsed = parseJson('{"__proto__":{"polluted":1},"a":{"constructor":{"x":1}}}');
  assert.equal({}.polluted, undefined);
  assert.equal(Object.hasOwn(parsed, '__proto__'), false);
  assert.throws(
    () => parseJson('<html>'),
    (err) => err.kind === 'bad_response',
  );
});

test('the configuration and the memory are repaired', () => {
  const config = normalizeConfig({
    client_id: ' id ',
    client_secret: 'a b',
    token_endpoint: 'evil',
    redirect_uri: 'http://lan.example/cb',
    poll_minutes: 1,
  });
  assert.equal(config.clientId, 'id');
  assert.equal(config.clientSecret, '');
  assert.equal(config.tokenEndpoint, 'api');
  assert.equal(config.redirectUri, '');
  assert.equal(config.pollMinutes, 15);
  const memory = normalizeMemory(
    {
      pause: { kind: 'rate', until: NOW + 30 * DAY },
      block: { kind: 'weird', client: '0123456789abcdef' },
      lastCycleAt: NOW + DAY,
    },
    NOW,
  );
  assert.ok(memory.pause.until <= NOW + 6 * HOUR, 'a pause read back is capped');
  assert.equal(memory.block, null);
  assert.equal(memory.lastCycleAt, NOW, 'never in the future');
});
