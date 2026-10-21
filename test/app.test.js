// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys and a fake Oura behind the transport. Timers and Date are mocked:
// the tests move the clock.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { OuraApp } from '../src/app.js';
import { clientKey } from '../src/config.js';
import { ACTIONS, LIMITS, OAUTH_FIELD, TOKEN_URLS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { OuraError } from '../src/http.js';
import {
  CLIENT_ID,
  CLIENT_SECRET,
  DAY,
  GLADYS_REDIRECT,
  HOUR,
  MINUTE,
  NOW,
  SECOND,
  VALUES,
  collections,
} from './fixtures/oura.js';
import { answer, fakeOura, memoryStore, settle } from './helpers/fakeOura.js';

const CONFIG = { client_id: CLIENT_ID, client_secret: CLIENT_SECRET };
const CLIENT = clientKey(CLIENT_ID);
const DEVICE = `ext:test-integration:ring:${CLIENT}`;
const feature = (key) => `${DEVICE}:${key}`;
const READ = [
  'daily_sleep',
  'daily_readiness',
  'daily_activity',
  'sleep',
  'daily_spo2',
  'heartrate',
];

/** A logger keeping every line, to check that no secret nor health value reaches the logs. */
const recorder = (logs) =>
  Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ')),
    ]),
  );

async function setup(
  t,
  {
    config = CONFIG,
    store = memoryStore(),
    server = fakeOura(),
    now = NOW,
    signIn = store.data === null && Boolean(config.client_id),
    create = true,
    logs = [],
    mock = true,
    devices,
  } = {},
) {
  if (mock) {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now });
  }
  const gladys = createFakeGladys({ config, ...(devices ? { devices } : {}) });
  const app = new OuraApp({
    gladys,
    logger: recorder(logs),
    transport: server.transport,
    now: () => Date.now(),
    store,
  });
  registerHandlers(gladys, app);
  await gladys.connect();
  await settle();
  t.after(() => app.stop());
  const advance = async (ms, step = 10 * SECOND) => {
    for (let elapsed = 0; elapsed < ms; elapsed += step) {
      t.mock.timers.tick(Math.min(step, ms - elapsed));
      await settle();
    }
  };
  const connect = async (redirect = GLADYS_REDIRECT) => {
    const ack = await gladys.fake.oauthAuthorizeUrl(OAUTH_FIELD, redirect);
    assert.equal(ack.success, true, JSON.stringify(ack));
    return server.approve(ack.data.authorize_url);
  };
  if (signIn) {
    assert.equal(server.requests.length, 0, 'nothing sent before the click');
    const back = await connect();
    const ack = await gladys.fake.oauthCallback(OAUTH_FIELD, back);
    assert.equal(ack.success, true, JSON.stringify(ack));
    await settle();
  }
  if (create) {
    for (const d of gladys.fake.discoveredDevices) {
      await gladys.fake.deviceCreated(d);
    }
    await advance(2 * SECOND, SECOND);
  }
  return { gladys, app, server, store, advance, connect, logs };
}

const message = (gladys) => gladys.fake.connectionStatus?.message ?? {};
const last = (gladys, key) => gladys.fake.lastState(feature(key));
const apiCount = (server) => server.apiRequests.length;

/** Every health value of the fixtures, as it could be written. */
const healthTexts = () =>
  Object.values(VALUES)
    .filter((v) => String(v).length >= 2)
    .map(String);

test('without the client id and secret: the status asks for them, nothing is sent, Connect refuses', async (t) => {
  const { gladys, server, advance } = await setup(t, {
    config: { client_id: CLIENT_ID },
    signIn: false,
  });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(message(gladys).en, /client id and the client secret/);
  const ack = await gladys.fake.oauthAuthorizeUrl(OAUTH_FIELD, GLADYS_REDIRECT);
  assert.equal(ack.success, false);
  await advance(2 * HOUR, 10 * MINUTE);
  assert.equal(server.requests.length, 0);
});

test('signed out: never a request by itself; Connect builds the Oura address with a fresh state', async (t) => {
  const { gladys, server, advance, connect } = await setup(t, { signIn: false });
  assert.match(message(gladys).en, /Not signed in to Oura: click Connect/);
  await advance(2 * HOUR, 10 * MINUTE);
  assert.equal(server.requests.length, 0);
  const ack = await gladys.fake.oauthAuthorizeUrl(OAUTH_FIELD, GLADYS_REDIRECT);
  const url = new URL(ack.data.authorize_url);
  assert.equal(`${url.origin}${url.pathname}`, 'https://cloud.ouraring.com/oauth/authorize');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), CLIENT_ID);
  assert.equal(url.searchParams.get('redirect_uri'), GLADYS_REDIRECT);
  assert.equal(url.searchParams.get('scope'), 'daily heartrate spo2Daily');
  assert.ok(url.searchParams.get('state').length >= 16);
  assert.ok(
    !ack.data.authorize_url.includes(CLIENT_SECRET),
    'the secret never goes to the browser',
  );
  const again = await gladys.fake.oauthAuthorizeUrl(OAUTH_FIELD, GLADYS_REDIRECT);
  assert.notEqual(
    new URL(again.data.authorize_url).searchParams.get('state'),
    url.searchParams.get('state'),
  );
  // Not connected: the status shows the return address to register in the app.
  assert.match(message(gladys).en, /return address of this Gladys is https:\/\/gladys\.local/);
  await connect();
  assert.equal(server.requests.length, 0);
});

test('authorization, then one read: device, states, status, tokens in /data, no secret nor health value logged or kept', async (t) => {
  const logs = [];
  const { gladys, store, server } = await setup(t, { logs });
  const [exchange] = server.of('token');
  assert.equal(exchange.endpoint, TOKEN_URLS.api);
  assert.equal(exchange.method, 'POST');
  assert.equal(exchange.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(exchange.form.grant_type, 'authorization_code');
  assert.equal(exchange.form.redirect_uri, GLADYS_REDIRECT);
  assert.equal(exchange.form.client_id, CLIENT_ID);
  assert.equal(exchange.form.client_secret, CLIENT_SECRET);
  assert.deepEqual(
    server.apiRequests.map((r) => r.route),
    READ,
  );
  for (const r of server.apiRequests) {
    assert.equal(r.method, 'GET');
    assert.equal(r.headers.Authorization, `Bearer ${server.access}`);
  }
  const daily = server.of('daily_sleep')[0].query;
  assert.deepEqual(daily, { start_date: '2026-10-19', end_date: '2026-10-22' });
  assert.equal(server.of('heartrate')[0].query.end_datetime, '2026-10-21T08:00:00Z');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(message(gladys).en, /Connected to Oura/);

  const [d] = gladys.fake.discoveredDevices;
  assert.equal(d.external_id, DEVICE);
  assert.equal(d.name, 'Bague Oura');
  assert.ok(d.features.every((f) => f.read_only === true && f.keep_history === false));
  const units = Object.fromEntries(d.features.map((f) => [f.external_id, f.unit]));
  assert.equal(units[feature('sleep_duration')], 'hours');
  assert.equal(units[feature('sleep_score')], undefined);

  assert.equal(last(gladys, 'sleep_score'), VALUES.sleepScore);
  assert.equal(last(gladys, 'readiness_score'), VALUES.readinessScore);
  assert.equal(last(gladys, 'activity_score'), VALUES.activityScore);
  assert.equal(last(gladys, 'sleep_duration'), 7.25);
  assert.equal(last(gladys, 'deep_sleep'), 1.5);
  assert.equal(last(gladys, 'rem_sleep'), 1.75);
  assert.equal(
    last(gladys, 'lowest_heart_rate'),
    VALUES.lowestHeartRate,
    'the main sleep, not the nap',
  );
  assert.equal(last(gladys, 'average_hrv'), VALUES.averageHrv);
  assert.equal(last(gladys, 'temperature_deviation'), VALUES.temperatureDeviation);
  assert.equal(last(gladys, 'spo2'), VALUES.spo2);
  assert.equal(last(gladys, 'steps'), VALUES.steps);
  assert.equal(last(gladys, 'active_calories'), VALUES.activeCalories);
  assert.equal(last(gladys, 'heart_rate'), VALUES.heartRate);

  const saved = JSON.stringify(store.data);
  assert.equal(store.data.session.client, CLIENT);
  assert.equal(store.data.session.refreshToken, server.refresh);
  assert.ok(!saved.includes(CLIENT_SECRET), 'the secret stays in Gladys');
  for (const value of healthTexts()) {
    assert.ok(!saved.includes(value), `a health value (${value}) reached /data`);
  }
  assert.deepEqual(
    [...new Set(gladys.fake.transports.map((e) => e.transport))].at(-1),
    DEVICE_TRANSPORTS.CLOUD,
  );
  const text = logs.join('\n');
  for (const secret of [CLIENT_SECRET, server.access, server.refresh, exchange.form.code]) {
    assert.ok(!text.includes(secret), 'a secret reached the logs');
  }
  for (const value of healthTexts()) {
    assert.ok(!text.includes(value), `a health value (${value}) reached the logs`);
  }
});

test('a return to Gladys with an unknown or missing state is refused; a state serves once', async (t) => {
  const { gladys, server, connect } = await setup(t, { signIn: false });
  const back = await connect();
  let ack = await gladys.fake.oauthCallback(OAUTH_FIELD, { ...back, state: 'forged' });
  assert.equal(ack.success, false);
  ack = await gladys.fake.oauthCallback(OAUTH_FIELD, { ...back, state: undefined });
  assert.equal(ack.success, false);
  assert.equal(server.requests.length, 0);
  ack = await gladys.fake.oauthCallback(OAUTH_FIELD, back);
  assert.equal(ack.success, true);
  ack = await gladys.fake.oauthCallback(OAUTH_FIELD, back);
  assert.equal(ack.success, false, 'one use only');
  assert.equal(server.of('token').length, 1);
});

test('a refused code tells the user, nothing is retried', async (t) => {
  const { gladys, server, connect, advance } = await setup(t, { signIn: false });
  const back = await connect();
  server.queue('token', answer(400, { error: 'invalid_grant' }));
  const ack = await gladys.fake.oauthCallback(OAUTH_FIELD, back);
  assert.equal(ack.success, false);
  assert.match(ack.error, /invalid_grant/);
  await advance(2 * HOUR, 10 * MINUTE);
  assert.equal(server.requests.length, 1);
});

test('the other token endpoint is used when chosen, never both', async (t) => {
  const { server } = await setup(t, { config: { ...CONFIG, token_endpoint: 'moi' } });
  assert.deepEqual(
    server.of('token').map((r) => r.endpoint),
    [TOKEN_URLS.moi],
  );
});

test('another redirect URI: the pasted address finishes the authorization', async (t) => {
  const redirect = 'https://my.example.org/oura/return';
  const { gladys, server, connect } = await setup(t, {
    config: { ...CONFIG, redirect_uri: redirect },
    signIn: false,
  });
  const back = await connect();
  assert.equal(back.redirectUri, redirect, 'the configured address, not Gladys');
  let ack = await gladys.fake.action(ACTIONS.FINISH_SIGN_IN, { url: 'hello' });
  assert.match(ack.data.message.en, /No authorization code/);
  ack = await gladys.fake.action(ACTIONS.FINISH_SIGN_IN, {
    url: `${redirect}?error=access_denied&error_description=Click+evil.example+now&state=${back.state}`,
  });
  assert.match(ack.data.message.en, /did not authorize the app \(access_denied\)/);
  assert.doesNotMatch(ack.data.message.en, /evil/, 'only a safe code is shown back');
  ack = await gladys.fake.action(ACTIONS.FINISH_SIGN_IN, { url: `${redirect}?code=${back.code}` });
  assert.match(ack.data.message.en, /No authorization code/);
  for (const other of [
    `https://evil.example/oura/return?state=${back.state}&code=${back.code}`,
    `https://my.example.org/other?state=${back.state}&code=${back.code}`,
  ]) {
    ack = await gladys.fake.action(ACTIONS.FINISH_SIGN_IN, { url: other });
    assert.match(ack.data.message.en, /not the redirect URI/);
  }
  assert.equal(server.requests.length, 0, 'nothing exchanged');
  ack = await gladys.fake.action(ACTIONS.FINISH_SIGN_IN, {
    url: `${redirect}?code=${back.code}&state=${back.state}`,
  });
  assert.match(ack.data.message.en, /Authorized by Oura/);
  await settle();
  const [exchange] = server.of('token');
  assert.equal(exchange.form.redirect_uri, redirect);
  assert.equal(exchange.timeout, 10 * SECOND);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  ack = await gladys.fake.action(ACTIONS.FINISH_SIGN_IN, {
    url: `${redirect}?code=${back.code}&state=${back.state}`,
  });
  assert.match(ack.data.message.en, /does not belong to an authorization/, 'the state served once');
});

test('the return relayed by Gladys: exchanged within 3.5 s, a slow Oura asks for a new click', async (t) => {
  const { gladys, server, connect } = await setup(t, { signIn: false });
  const back = await connect();
  server.queue('token', async (request) => {
    assert.equal(request.timeout, 3500);
    throw new OuraError('timeout', 'no answer within 4 s');
  });
  let ack = await gladys.fake.oauthCallback(OAUTH_FIELD, back);
  assert.equal(ack.success, false);
  assert.match(ack.error, /Oura lent, cliquez de nouveau sur Connecter/);
  ack = await gladys.fake.oauthCallback(OAUTH_FIELD, back);
  assert.equal(ack.success, false);
  assert.equal(server.of('token').length, 1);
});

test('the token is renewed by a timer before its end; the new renewal token is kept (they serve once)', async (t) => {
  const server = fakeOura({ expiresIn: 1800 });
  const { advance, gladys, store } = await setup(t, { server });
  assert.equal(server.of('token').length, 1);
  // 1800 s token: margin min(10 min, 900 s) -> renewed at 20 min.
  await advance(19 * MINUTE, MINUTE);
  assert.equal(server.of('token').length, 1);
  await advance(2 * MINUTE, 10 * SECOND);
  const renewals = server.of('token').filter((r) => r.form.grant_type === 'refresh_token');
  assert.equal(renewals.length, 1);
  assert.equal(renewals[0].form.refresh_token, 'refresh-1');
  assert.equal(store.data.session.refreshToken, 'refresh-2');
  server.expiresIn = 10;
  // The current token still runs 30 minutes; then 10-second tokens.
  await advance(30 * MINUTE, 5 * SECOND);
  const count = server.of('token').length - 2;
  // 10-second tokens from the 20th minute on: one renewal a minute, never more.
  assert.ok(count >= 5 && count <= 12, `${count} renewals in 30 minutes (never twice a minute)`);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.ok(server.used.size === server.issued - 1, 'never a used renewal token sent again');
});

test('two renewals asked together send one request', async (t) => {
  const { app, server, advance } = await setup(t);
  await advance(2 * MINUTE, MINUTE);
  const before = server.of('token').length;
  let release;
  server.queue('token', () => new Promise((resolve) => (release = resolve)));
  const a = app.renew();
  const b = app.renew();
  await settle();
  release(answer(200, { access_token: 'A2', refresh_token: 'R2', expires_in: 3600 }));
  await Promise.all([a, b]);
  assert.equal(server.of('token').length, before + 1);
  // And never again within a minute.
  await assert.rejects(app.renew(), (err) => err.kind === 'renew_wait');
  assert.equal(server.of('token').length, before + 1);
});

test('a refused renewal stops everything, kept across a restart; only an authorization resumes', async (t) => {
  const store = memoryStore();
  const server = fakeOura({ expiresIn: 1800 });
  const { gladys, app, advance } = await setup(t, { server, store });
  server.refresh = 'rotated-elsewhere';
  await advance(22 * MINUTE, MINUTE);
  assert.match(message(gladys).en, /session ended/);
  assert.equal(store.data.block.kind, 'expired');
  assert.equal(store.data.session, null);
  const before = server.requests.length;
  await advance(6 * HOUR, 10 * MINUTE);
  assert.equal(server.requests.length, before, 'nothing retried by itself');
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /session ended/);
  assert.equal(server.requests.length, before);

  app.stop();
  const again = await setup(t, { server, store, mock: false, create: false });
  assert.match(message(again.gladys).en, /session ended/);
  await again.advance(2 * HOUR, 10 * MINUTE);
  assert.equal(server.requests.length, before);
  const back = await again.connect();
  const ok = await again.gladys.fake.oauthCallback(OAUTH_FIELD, back);
  assert.equal(ok.success, true);
  await settle();
  assert.equal(store.data.block, null);
  assert.ok(store.data.session.refreshToken);
});

test('a 429 pauses every path, kept in /data across a restart and a reconnection', async (t) => {
  const store = memoryStore();
  const server = fakeOura();
  const { gladys, app, advance } = await setup(t, { server, store });
  server.queue('daily_sleep', answer(429, {}, { 'retry-after': '3600' }));
  await advance(30 * MINUTE, MINUTE);
  assert.match(message(gladys).en, /slow down: pause of 60 min/);
  assert.equal(store.data.pause.kind, 'rate');
  const before = server.requests.length;
  await gladys.disconnect();
  await gladys.connect();
  await settle();
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /slow down/);
  const connectAck = await gladys.fake.oauthAuthorizeUrl(OAUTH_FIELD, GLADYS_REDIRECT);
  assert.equal(connectAck.success, false, 'no sign-in during a 429 pause');
  await advance(40 * MINUTE, MINUTE);
  assert.equal(server.requests.length, before, 'nothing during the pause');
  app.stop();
  const again = await setup(t, { server, store, mock: false, create: false });
  assert.match(message(again.gladys).en, /slow down/);
  await again.advance(10 * MINUTE, MINUTE);
  assert.equal(server.requests.length, before);
  await again.advance(15 * MINUTE, MINUTE);
  assert.ok(server.requests.length > before, 'read again after the pause');
  assert.equal(store.data.pause, null);
});

test('a 429 on a secondary collection ends the cycle and pauses too', async (t) => {
  const store = memoryStore();
  const server = fakeOura();
  const { advance } = await setup(t, { server, store });
  server.queue('daily_spo2', answer(429, {}));
  await advance(30 * MINUTE, MINUTE);
  assert.equal(store.data.pause.kind, 'rate');
  assert.equal(server.of('heartrate').length, 1, 'the rest of the cycle is not read');
});

test('5xx on the main data: a pause kept in /data, never sooner than the interval', async (t) => {
  const store = memoryStore();
  const server = fakeOura();
  const { gladys, advance } = await setup(t, { server, store });
  server.queue('daily_sleep', answer(503, {}));
  await advance(30 * MINUTE, MINUTE);
  assert.match(message(gladys).en, /unavailable/);
  assert.equal(store.data.pause.kind, 'unavailable');
  const before = server.of('daily_sleep').length;
  await advance(29 * MINUTE, MINUTE);
  assert.equal(server.of('daily_sleep').length, before);
  await advance(2 * MINUTE, MINUTE);
  assert.equal(server.of('daily_sleep').length, before + 1);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a secondary collection failing (5xx, scope, timeout) never stops the others', async (t) => {
  const store = memoryStore();
  const server = fakeOura();
  const { gladys, advance, logs } = await setup(t, { server, store });
  server.queue('daily_spo2', answer(401, { detail: 'scope' }));
  server.queue('sleep', answer(502, {}));
  server.queue('heartrate', async () => {
    throw new OuraError('timeout', 'no answer within 15 s');
  });
  const tokens = server.of('token').length;
  await advance(30 * MINUTE, MINUTE);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(message(gladys).en, /Not read this time: sleep periods, SpO2, heart rate/);
  assert.equal(server.of('token').length, tokens, 'a 401 on a secondary collection never renews');
  assert.equal(store.data.block, null);
  assert.equal(store.data.pause, null);
  assert.equal(last(gladys, 'sleep_score'), VALUES.sleepScore);
  assert.ok(logs.some((l) => /daily_spo2 not read/.test(l)));
});

test('the SpO2 scope not granted: the other values are read, never a stop', async (t) => {
  const server = fakeOura();
  server.granted = new Set(['daily', 'heartrate']);
  const { gladys, store } = await setup(t, { server });
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(message(gladys).en, /Not read this time: SpO2/);
  assert.equal(last(gladys, 'spo2'), undefined);
  assert.equal(last(gladys, 'steps'), VALUES.steps);
  assert.equal(store.data.block, null);
});

test('a refused token: one renewal and one retry; refused again, a stop only a click lifts', async (t) => {
  const store = memoryStore();
  const server = fakeOura();
  const { gladys, advance } = await setup(t, { server, store });
  server.revokeAccess();
  await advance(30 * MINUTE, MINUTE);
  assert.equal(server.of('token').filter((r) => r.form.grant_type === 'refresh_token').length, 1);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  server.queue('daily_sleep', answer(401, {}), 2);
  server.revokeAccess();
  await advance(30 * MINUTE, MINUTE);
  assert.match(message(gladys).en, /refused the access even with a new token/);
  assert.equal(store.data.block.kind, 'unauthorized');
  const before = server.requests.length;
  await advance(3 * HOUR, 10 * MINUTE);
  assert.equal(server.requests.length, before, 'nothing retried by itself');
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /Connected to Oura/);
  assert.equal(store.data.block, null);
});

test('403 on the main data (membership): a 6-hour pause kept in /data, never a stop', async (t) => {
  const store = memoryStore();
  const server = fakeOura();
  const { gladys, advance } = await setup(t, { server, store });
  server.queue('daily_sleep', answer(403, {}));
  await advance(30 * MINUTE, MINUTE);
  assert.equal(store.data.pause.kind, 'forbidden');
  assert.equal(store.data.block, null);
  assert.match(message(gladys).en, /active Oura membership/);
  const before = server.of('daily_sleep').length;
  await advance(5 * HOUR, 10 * MINUTE);
  assert.equal(server.of('daily_sleep').length, before);
  await advance(90 * MINUTE, 10 * MINUTE);
  assert.ok(server.of('daily_sleep').length > before);
});

test('the daily budget of requests: reached, everything waits for the next UTC day', async (t) => {
  const store = memoryStore();
  const server = fakeOura();
  const { gladys, app, advance } = await setup(t, { server, store });
  app.memory.requests.count = LIMITS.dailyRequests;
  await advance(30 * MINUTE, MINUTE);
  assert.equal(store.data.pause.kind, 'budget');
  assert.match(message(gladys).en, /daily number of requests/);
  const before = server.requests.length;
  // 08:30 UTC: 15 h 30 min to midnight, plus a minute.
  await advance(15 * HOUR, 10 * MINUTE);
  assert.equal(server.requests.length, before);
  await advance(2 * HOUR, 10 * MINUTE);
  assert.ok(server.requests.length > before, 'read again the next day');
});

test('a network failure is never read again sooner than the interval', async (t) => {
  const server = fakeOura();
  const { gladys, advance } = await setup(t, { server, config: { ...CONFIG, poll_minutes: 60 } });
  server.queue('daily_sleep', async () => {
    throw Object.assign(new Error('boom'), { code: 'ECONNRESET' });
  });
  await advance(60 * MINUTE, MINUTE);
  assert.match(message(gladys).en, /could not be read \(connection reset\)/);
  const before = server.of('daily_sleep').length;
  await advance(59 * MINUTE, MINUTE);
  assert.equal(server.of('daily_sleep').length, before);
  await advance(2 * MINUTE, MINUTE);
  assert.equal(server.of('daily_sleep').length, before + 1);
});

test('a restart right after a good read stays connected and waits the interval', async (t) => {
  const store = memoryStore();
  const server = fakeOura();
  const first = await setup(t, { server, store });
  await first.advance(5 * MINUTE, MINUTE);
  first.app.stop();
  const before = server.requests.length;
  const { gladys, advance } = await setup(t, { server, store, mock: false, create: false });
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(message(gladys).en, /Connected to Oura.*next read in 25 min/);
  assert.equal(server.requests.length, before, 'the interval is still respected');
  // Nothing published before the first read: no health value in /data.
  await advance(24 * MINUTE, MINUTE);
  assert.equal(server.requests.length, before);
  await advance(2 * MINUTE, MINUTE);
  assert.ok(server.requests.length > before);
});

test('nothing reads sooner than the interval: reconnection, Discovery, unchanged configuration, test button', async (t) => {
  const { gladys, app, server, advance } = await setup(t);
  const statuses = gladys.fake.connectionStatuses.length;
  const lists = gladys.fake.bodies('POST', '/discovered_device').length;
  const before = apiCount(server);
  await gladys.disconnect();
  await gladys.connect();
  await settle();
  assert.equal(gladys.fake.connectionStatuses.length, statuses + 1, 'status sent again');
  assert.equal(gladys.fake.bodies('POST', '/discovered_device').length, lists + 1);
  await app.scan();
  await gladys.fake.configUpdated({ ...CONFIG });
  await settle();
  let ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /Connected to Oura.*next read in 30 min/);
  assert.equal(apiCount(server), before);
  // The interval passed: one read, then 30 seconds between clicks.
  await advance(29 * MINUTE + 50 * SECOND, MINUTE);
  const due = apiCount(server);
  app.memory.lastCycleAt -= 30 * MINUTE;
  ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /Connected to Oura/);
  assert.equal(apiCount(server), due + READ.length);
  ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /less than 30 seconds|next read in/);
  assert.equal(apiCount(server), due + READ.length);
});

test('an error pause: ten test clicks 31 s apart never read', async (t) => {
  const { gladys, server, advance } = await setup(t);
  server.queue('daily_sleep', answer(418, {}));
  await advance(30 * MINUTE, MINUTE);
  assert.match(message(gladys).en, /could not be read/);
  const paused = apiCount(server);
  for (let i = 0; i < 10; i += 1) {
    const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
    assert.match(ack.data.message.en, /next read in/);
    await advance(31 * SECOND, 31 * SECOND);
  }
  assert.equal(apiCount(server), paused);
});

test('stale data is never published as current; the status says the ring did not sync', async (t) => {
  const server = fakeOura();
  const { gladys, advance } = await setup(t, { server });
  const old = collections(NOW - 3 * DAY);
  server.data = old;
  await advance(30 * MINUTE, MINUTE);
  assert.match(message(gladys).en, /no recent sleep data/);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  const states = gladys.fake.bodies('POST', '/state').length;
  await advance(2 * HOUR, 30 * MINUTE);
  assert.equal(gladys.fake.bodies('POST', '/state').length, states, 'nothing old published');
});

test('a heart rate sample older than 3 hours is not published', async (t) => {
  const server = fakeOura();
  const data = collections(NOW);
  data.heartrate = [{ bpm: 70, source: 'rest', timestamp: new Date(NOW - 4 * HOUR).toISOString() }];
  server.data = data;
  const { gladys } = await setup(t, { server });
  assert.equal(last(gladys, 'heart_rate'), undefined);
  assert.equal(last(gladys, 'sleep_score'), VALUES.sleepScore);
});

test('the heart rate pages are followed, three at most', async (t) => {
  const server = fakeOura();
  const page = (token) =>
    answer(200, {
      data: [{ bpm: 60, source: 'rest', timestamp: new Date(NOW - 5 * MINUTE).toISOString() }],
      next_token: token,
    });
  server.queue('heartrate', page('p2'));
  server.queue('heartrate', page('p3'));
  server.queue('heartrate', page('p4'));
  const { gladys } = await setup(t, { server });
  assert.equal(server.of('heartrate').length, 3);
  assert.deepEqual(server.of('heartrate')[1].query, { next_token: 'p2' });
  assert.equal(last(gladys, 'heart_rate'), 60);
});

test('a read in flight when the configuration changes: its late answer publishes nothing', async (t) => {
  const server = fakeOura();
  const { gladys, advance } = await setup(t, { server });
  let release;
  server.queue('daily_sleep', () => new Promise((resolve) => (release = resolve)));
  await advance(30 * MINUTE, MINUTE);
  assert.ok(release, 'read in flight');
  const statuses = gladys.fake.connectionStatuses.length;
  const states = gladys.fake.bodies('POST', '/state').length;
  // The restart waits for the read in flight (bounded by its timeout in real life).
  const saving = gladys.fake.configUpdated({
    client_id: 'ANOTHERCLIENT',
    client_secret: CLIENT_SECRET,
  });
  await settle();
  release(answer(200, { data: [{ day: '2026-10-21', score: 12 }] }));
  await saving;
  await settle();
  assert.match(message(gladys).en, /Not signed in/);
  assert.equal(gladys.fake.bodies('POST', '/state').length, states);
  assert.ok(
    gladys.fake.connectionStatuses
      .slice(statuses)
      .every((s) => !/Connected to Oura/.test(s.message?.en ?? '')),
  );
});

test('new keys saved while a renewal is in flight: its answer is dropped', async (t) => {
  const server = fakeOura({ expiresIn: 1800 });
  const { gladys, store, advance } = await setup(t, { server });
  let release;
  server.queue('token', () => new Promise((resolve) => (release = resolve)));
  await advance(21 * MINUTE, MINUTE);
  assert.ok(release, 'renewal in flight');
  await gladys.fake.configUpdated({ ...CONFIG, client_id: 'OTHERCLIENT' });
  await settle();
  release(answer(200, { access_token: 'OLD', refresh_token: 'OLD-R', expires_in: 3600 }));
  await settle();
  assert.notEqual(store.data.session?.accessToken, 'OLD');
});

test('the device never loses a feature; a new language renames only what Gladys does not hold', async (t) => {
  const { gladys } = await setup(t);
  const before = gladys.fake.discoveredDevices[0].features.map((f) => f.external_id).sort();
  await gladys.fake.configUpdated({ ...CONFIG, language: 'en' });
  await settle();
  const after = gladys.fake.discoveredDevices[0];
  assert.deepEqual(after.features.map((f) => f.external_id).sort(), before);
  assert.equal(after.name, 'Oura ring');
});
