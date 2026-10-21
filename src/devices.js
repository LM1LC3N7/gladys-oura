// -----------------------------------------------------------------------------
// The Oura account -> one Gladys device, and its states (pure).
//
//   `ring:<client key>`: the client key is a hash of the client id of the
//   Oura app (src/config.js), stable; no Oura account id is read (the
//   `personal` scope is not asked), so nothing personal is in the ids.
//
// Units and types: only those the core lists for each category
// (server/utils/constants.js: DEVICE_FEATURE_UNITS_BY_CATEGORY). The core has
// no category for a score, a heart rate, a variability, a blood oxygen nor a
// deviation of body temperature: they are `unknown` sensors without a unit,
// the unit in the name (a body temperature deviation is never a
// `temperature-sensor`: a scene on a room temperature must never take it).
// The sleep durations are `duration` in hours. All read only. Health data:
// no history by default (the user may turn it on per feature).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as TY,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { DEVICE_TYPE } from './constants.js';
import { DEVICE_NAME, FEATURE_NAMES, word } from './i18n.js';

const integer = (min, max) => ({ category: C.UNKNOWN, type: TY.SENSOR.INTEGER, min, max });
const decimal = (min, max) => ({ category: C.UNKNOWN, type: TY.SENSOR.DECIMAL, min, max });
const hours = { category: C.DURATION, type: TY.DURATION.DECIMAL, unit: U.HOURS, min: 0, max: 24 };

/** The features, by role (the role is the key of the value in src/model.js). */
export const FEATURES = {
  sleep_score: integer(0, 100),
  readiness_score: integer(0, 100),
  activity_score: integer(0, 100),
  sleep_duration: hours,
  deep_sleep: hours,
  rem_sleep: hours,
  lowest_heart_rate: integer(20, 250),
  average_hrv: integer(0, 500),
  temperature_deviation: decimal(-10, 10),
  spo2: decimal(50, 100),
  steps: integer(0, 500_000),
  active_calories: integer(0, 50_000),
  heart_rate: integer(20, 250),
};

export const deviceIds = (gladys, client) => gladys.externalIds(DEVICE_TYPE, client);

/** The Gladys device of an Oura app, its names in `language`. */
export function buildDevice(gladys, client, language) {
  const ids = deviceIds(gladys, client);
  return {
    name: word(DEVICE_NAME, language),
    external_id: ids.device,
    model: 'Oura API v2',
    should_poll: false,
    features: Object.entries(FEATURES).map(([role, spec]) => ({
      name: word(FEATURE_NAMES[role], language).slice(0, 100),
      external_id: ids.feature(role),
      category: spec.category,
      type: spec.type,
      ...(spec.unit ? { unit: spec.unit } : {}),
      min: spec.min,
      max: spec.max,
      read_only: true,
      has_feedback: false,
      keep_history: false,
    })),
  };
}

/**
 * The states of the values of a read: `[[featureId, value]]`, only for the
 * values present and within the bounds of the feature (an absent value is
 * never published, never as 0).
 */
export function deviceStates(gladys, client, values) {
  const ids = deviceIds(gladys, client);
  const states = [];
  for (const [role, spec] of Object.entries(FEATURES)) {
    const value = values?.[role];
    if (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= spec.min &&
      value <= spec.max
    ) {
      states.push([ids.feature(role), value]);
    }
  }
  return states;
}
