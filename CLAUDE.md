# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15), its only
runtime dependency (HTTPS goes through `node:https`). It reads an Oura ring
through the official Oura API v2, read only, after an OAuth2 authorization of
an app the user creates on the Oura developer portal. Health data, **not a
medical device**. Ported from oura-ring and the Home Assistant integration
(MIT). Never tested with a real account nor a real device, not affiliated
with Oura. The authorization model is the one of gladys-sungrow (approved).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npm run cover                             # cover.png, plain Node
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` (Node 22 and 24) and `audit` before every
commit.

## Architecture

```
index.js            SDK bootstrap only
src/handlers.js     every SDK handler -> the app (shared with the tests)
src/app.js          OuraApp: authorization, renewal timer, cycle and its timer, pauses,
                    daily budget, stops, device, states, badge, buttons
src/oauth.js        authorization address, pending sign-ins, pasted address, token endpoint
src/api.js          one GET of a collection, its query (days or times)
src/http.js         the only network access (node:https, bounded), errors by status, JSON
src/model.js        answers -> values (pure): latest daily record, main sleep, heart rate
src/devices.js      the device and its states (pure)
src/publisher.js    states within 300/min, each record once (key value@day, bpm@time)
src/store.js        /data/oura-state.json (0600): tokens, stop, pause, budget, times
src/config.js       config_schema normalized, client key (hash of the client id)
src/constants.js    endpoints, scopes, collections, manifest keys, limits, timings
src/i18n.js         runtime texts, device and feature names (en/fr)
scripts/cover.mjs   cover.png (800×534) in plain Node
test/fixtures/      answers shaped like those the references read
test/helpers/       a fake Oura behind the transport; Gladys is the SDK's fake
```

## Rules

- **External ids are forever**: device `ring:<client key>`, features by role
  (see `src/devices.js`). Never change how they are built.
- Manifest keys (`client_id`, `client_secret`, `redirect_uri`, `account`,
  `token_endpoint`, `poll_minutes`, `language`, the actions `finish_sign_in`
  (`url`), `test_connection`) are frozen.
- **Health data**: read only, no command; values in memory only, never in a
  log, a status, an error nor `/data`; no history by default; only recent
  data published, each record once (never a heartbeat, never queued after a
  failed read; the heart rate with `created_at` = its sample time). Say "not a medical device" wherever the user reads.
- **Authorization only on a click** (Connect, Finish the authorization): never
  from a start, a `connected`, a cycle or a retry. The state serves once. A
  refused renewal is the `expired` stop; an access refused with a fresh token
  the `unauthorized` stop: both persisted, never retried by themselves. Never
  log a token, a code or the client secret.
- **Token renewal**: by a timer at the end minus min(10 min, half the
  lifetime), one at a time (joined), never twice within a minute (kept in
  `/data` before the request), never during a hard pause. Renewal tokens
  serve once: the new one is saved at once, even across a restart (start()
  waits for it; dropped only when the session was replaced). A session is
  renewed at the endpoint that issued it. Never both token endpoints.
- **Rate limits**: never read sooner than the interval (test button, scan,
  `connected`, unchanged configuration, restart, sign-in); 429 / 5xx / budget
  pause every path, 403 pauses the reads, all kept in `/data`. A secondary
  collection (everything but `daily_sleep`) refused, 5xx or timing out only
  leaves its values out; a 401 there never renews.
- A late answer (old generation) publishes nothing and sets no status.
- The Discovery list never shrinks; status and Discovery are sent again at
  every `connected`; a reconnection keeps tokens, stops and pauses.
- Units only from the core's `DEVICE_FEATURE_UNITS_BY_CATEGORY`; a `secret`
  field is kept by Gladys in its database, never write otherwise.
- Files are UTF-8 without BOM, no control byte (`test/encoding.test.js`);
  tests never touch the network nor the system temp directory.
- Code, comments, README in English; `docs/en.md` and `docs/fr.md` kept in sync.
- Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md`; versions belong to the Release workflow (0.1.0 was set by
  hand once, see TODO.md).
