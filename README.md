# Gladys Oura

An external integration for [Gladys Assistant](https://gladysassistant.com)
that reads an **Oura ring** through the **official Oura API v2**, read only:
sleep, readiness and activity scores, sleep durations, lowest heart rate and
heart rate variability of the night, body temperature deviation, SpO2, steps,
active calories and the latest heart rate, on one Gladys device.

> **Not a medical device.** Never use these values for a diagnosis or a
> treatment decision: they may be late, missing or wrong.

Unofficial, not affiliated with Oura. **Never tested with a real ring nor a
real account.**

- User guide: [English](docs/en.md) · [Français](docs/fr.md)
- Needs an OAuth2 app the user creates on the
  [Oura developer portal](https://developer.ouraring.com/) (personal access
  tokens are no longer accepted by Oura), and an active Oura membership.

## How it works

- **Authorization** on a click only (Connect, or a pasted return address),
  with a state that serves once; the password is typed on the Oura page only.
- **Tokens** in `/data` (0600), renewed by a timer before their end, one
  renewal at a time, never twice within a minute; a refused renewal is a stop
  kept in `/data`, never retried by itself.
- **Reads**: every 30 minutes by default (15 to 240), 6 to 8 requests each,
  at most 1,000 a day; never sooner than the interval, whatever starts it.
  429, 5xx, 403 and the daily budget pause the reads, kept in `/data`.
- **Health data** stays in memory and goes to Gladys only: never in the logs,
  the statuses nor `/data`. No history by default.

## Development

```bash
npm install
npm run format:check
npm run lint
npm test
npm run audit
npm run cover          # regenerates cover.png (plain Node)
```

See [CLAUDE.md](CLAUDE.md) for the rules and [TODO.md](TODO.md) for the
status and the decisions.

## Credits and license

Logic ported from [oura-ring](https://github.com/hedgertronic/oura-ring) (MIT)
and [Oura-Home-Assistant-Integration](https://github.com/louispires/Oura-Home-Assistant-Integration)
(MIT), see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Licensed under
the Apache License 2.0 ([LICENSE](LICENSE)). Oura is a trademark of its owner.
