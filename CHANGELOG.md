# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- The Oura ring through the official Oura API v2, read only, one Gladys
  device: sleep, readiness and activity scores, sleep durations (total, deep,
  REM), lowest heart rate and heart rate variability of the night, body
  temperature deviation, SpO2, steps, active calories, latest heart rate. No
  history by default. Not a medical device.
- OAuth2 with an Oura app the user creates: Connect returning to Gladys (its
  return address shown in the status while not connected) or a pasted
  address; a state that serves once; the token renewed by a timer, one
  renewal at a time, never twice within a minute; a refused renewal or an
  access refused with a new token is a stop kept in `/data`, never retried by
  itself. Choice of the token endpoint (documented, or the one of the new
  developer portal).
- Rate limits: 15 minutes at least between reads (30 by default), whatever
  starts them, restarts included; 429, 5xx, 403 (membership) and a daily
  budget of 1,000 requests pause the reads, kept in `/data`. A secondary
  collection refused or failing never stops the others.
- Only recent data is published (yesterday or today; a heart rate of the last
  3 hours). Health values never in the logs, the statuses nor `/data`.
- Docs in English and French with the Oura app step by step, cover image.

[Unreleased]: https://github.com/LM1LC3N7/gladys-oura/commits/main
