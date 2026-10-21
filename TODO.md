# TODO — Oura v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm run audit`, `npx github:GladysAssistant/integration-store .`,
  then update README, `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- No forum topic of its own, no forum post from a module session: the batch
  reserved in /t/10385 (lot 12) gets one recap message there.
- The `gladys-assistant-integration` topic is added at the first real release only.

## Status

- [x] **Milestone 1 — core** (2026-10-21): OAuth2 of the user's Oura app
      (Connect returning to Gladys, or a pasted address; the Gladys return
      address shown in the status while not connected; a state serving once),
      tokens in `/data` renewed by a timer (single flight, a minute floor kept
      in `/data`), six collections read per cycle (daily_sleep primary; the
      others secondary), one read-only device of 13 features, persisted stops
      and pauses (429, 5xx, 403, daily budget, errors), never a read sooner
      than the interval, badge, docs en/fr with the Oura app step by step,
      cover. Tested against made-up answers only (Node 22 and 24). The store
      validator cannot run from the development sandbox: it runs at
      publication. No Docker on this PC: the image was not built here (the CI
      builds it).
- [ ] **Milestone 2 — real account**: run against a real account and ring
      (see "To check on a real account"), turn the answers (anonymized) into
      fixtures, fix what differs.
- [ ] **Later**: ring battery (`ring_configuration` scope), stress and
      resilience (`stress` scope), workouts, scene triggers (sleep score
      below a threshold, ring synced) if users ask.

## Decisions

- **Version 0.1.0 set by hand** in `package.json`, `package-lock.json`, the
  manifest and `docker_image` (`ghcr.io/lm1lc3n7/gladys-oura:0.1.0`); the
  first patch release gives 0.1.1.
- **References**: oura-ring 1.0.1 (MIT, hedgertronic) for the OAuth2 flow and
  louispires/Oura-Home-Assistant-Integration (MIT) for the collections and the
  choice of the records; both licenses read in their `LICENSE` file, notices
  in `THIRD_PARTY_NOTICES.md`, copied into the image. Neighbour modules
  followed: gladys-sungrow (OAuth2 model, approved), gladys-dexcom (health:
  no history, not a medical device, nothing in the logs).
- **OAuth2 only**: Oura no longer accepts personal access tokens. The user
  creates the app (no shared client secret in the image). Same model as
  gladys-sungrow: Connect with Gladys' return, or a redirect URI of the user
  and a pasted address; state of 128 random bits, 15 minutes, one use.
- **Token endpoint chosen by the user**, `api.ouraring.com/oauth/token` by
  default (Oura docs, oura-ring); `moi.ouraring.com/oauth/v2/ext/oauth-token`
  as an option (the Home Assistant integration says the new portal apps need
  it). Never both one after the other: a code serves once (HA issue #75).
- **Scopes `daily heartrate spo2Daily`** only: no `email`, no `personal`
  (age, weight, sex). So no Oura account id is read: the device id is a hash
  of the client id (one Oura account per app).
- **Primary / secondary collections**: `daily_sleep` decides the cycle (a 401
  there renews once then stops; 403 a 6-hour pause: the membership). The
  others (readiness, activity, sleep periods, SpO2, heart rate) are left out
  alone on 401/403 (scope not granted, ring or membership without the
  feature), 5xx, timeout or network error; a 401 there never renews. A 429
  anywhere pauses everything.
- **Interval** 30 minutes by default, 15 minimum: the ring syncs through the
  phone app. Daily budget 1,000 requests (8 per cycle at most). Oura allows
  5,000 requests per 5 minutes.
- **Freshness**: daily records of yesterday or today (UTC, with tomorrow for
  timezones ahead), heart rate samples of the last 3 hours; anything older is
  not published as current. The sleep shown is the main sleep (`long_sleep`)
  of the latest day, otherwise its longest completed period.
- **Features without a core unit** (scores, bpm, ms, %, °C deviation) are
  `unknown` sensors, the unit in the name; the deviation of body temperature
  is never a `temperature-sensor` (room temperature scenes). Durations are
  `duration` in hours. `keep_history: false` for all (health data).
- **No health value in `/data`**: after a restart, nothing is published until
  the next read (the status still says connected when the last read
  succeeded).
- **After a sign-in**, the read waits the interval if a read ran less than the
  interval ago (never sooner, whatever starts it).
- **Test button after an access refused**: lifts the stop for one read, still
  never sooner than the interval.
- **No scene trigger** in v1 (`publishSceneEvent` not used).

## To check on a real account

- The developer portal: the names of the pages and fields, whether it asks
  for scopes, whether a redirect URI must be https (and whether
  `http://localhost` is accepted), whether several redirect URIs are allowed.
- The authorization: that the scope `spo2Daily` is accepted (oura-ring: spec
  name; the HA integration asks `spo2`); that `state` comes back; the token
  endpoint that works for a new app (`api` or `moi`); the token answer
  (`expires_in`, a new `refresh_token` at each renewal).
- The answers: the fields read (`score`, `temperature_deviation`, `steps`,
  `active_calories`, `total_sleep_duration`, `deep_sleep_duration`,
  `rem_sleep_duration`, `lowest_heart_rate`, `average_hrv`,
  `spo2_percentage.average`, `bpm`, `timestamp`), the `day` of a record
  around midnight in Europe, whether `end_date` is inclusive, the size of a
  `sleep` answer of three days.
- The status codes: 401 on a scope not granted, 403 without membership, 429
  with or without `Retry-After`.
