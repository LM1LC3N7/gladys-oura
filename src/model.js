// -----------------------------------------------------------------------------
// Oura answers -> the values of the features (pure). The choice of the
// records is the one of the Home Assistant integration (coordinator.py):
// the latest daily record; for the sleep periods, the completed ones (both
// bedtimes), the main sleep (`long_sleep`) of the latest day when there is
// one; for the heart rate, the latest sample.
//
// Only recent data counts as current: a daily record of a day before
// yesterday (UTC) is left out (the ring did not sync since), and so is a
// heart rate sample older than TIMINGS.heartRateWindow. A value absent or
// out of bounds is left out, never 0. The loops are bounded and linear.
// -----------------------------------------------------------------------------

import { isoDay } from './api.js';
import { DAY, LIMITS, TIMINGS } from './constants.js';

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A finite number within [min, max], or null (never a string, never NaN). */
export function num(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null;
}

/** The records of an answer, bounded, objects only. */
function records(answer) {
  const list = Array.isArray(answer?.data) ? answer.data.slice(0, LIMITS.records) : [];
  return list.filter((r) => r !== null && typeof r === 'object' && !Array.isArray(r));
}

/** The days accepted at `now`: from yesterday to tomorrow (UTC). */
function dayRange(now) {
  return { first: isoDay(now - DAY), last: isoDay(now + DAY) };
}

const recent = (day, { first, last }) =>
  typeof day === 'string' && DAY_PATTERN.test(day) && day >= first && day <= last;

/** The record of the latest recent day (the last one listed for that day), or null. */
export function latestDaily(answer, now) {
  const days = dayRange(now);
  let best = null;
  for (const record of records(answer)) {
    if (recent(record.day, days) && (best === null || record.day >= best.day)) {
      best = record;
    }
  }
  return best;
}

/**
 * The sleep period shown: among the completed recent ones, those of the
 * latest day; the main sleep of that day when there is one, else the
 * longest. Null when none.
 */
export function mainSleep(answer, now) {
  const days = dayRange(now);
  let day = null;
  const completed = [];
  for (const record of records(answer)) {
    if (
      recent(record.day, days) &&
      typeof record.bedtime_start === 'string' &&
      typeof record.bedtime_end === 'string'
    ) {
      completed.push(record);
      if (day === null || record.day > day) {
        day = record.day;
      }
    }
  }
  let best = null;
  const rank = (r) => [r.type === 'long_sleep' ? 1 : 0, num(r.total_sleep_duration, 0, DAY) ?? 0];
  for (const record of completed) {
    if (record.day !== day) {
      continue;
    }
    if (best === null) {
      best = record;
      continue;
    }
    const [a, b] = [rank(record), rank(best)];
    if (a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])) {
      best = record;
    }
  }
  return best;
}

/** The latest heart rate sample of the pages, within the window: `{ bpm, at }` or null. */
export function latestHeartRate(pages, now) {
  let best = null;
  let seen = 0;
  for (const page of pages) {
    for (const sample of records(page)) {
      seen += 1;
      if (seen > LIMITS.records * LIMITS.heartRatePages) {
        return best;
      }
      const bpm = num(sample.bpm, 20, 250);
      const at = typeof sample.timestamp === 'string' ? Date.parse(sample.timestamp) : NaN;
      if (
        bpm === null ||
        !Number.isFinite(at) ||
        at > now + 5 * 60 * 1000 ||
        now - at > TIMINGS.heartRateWindow
      ) {
        continue;
      }
      if (best === null || at > best.at) {
        best = { bpm: Math.round(bpm), at };
      }
    }
  }
  return best;
}

const hours = (seconds) => {
  const value = num(seconds, 0, DAY / 1000);
  return value === null ? null : Math.round((value / 3600) * 100) / 100;
};
const integer = (value, min, max) => {
  const n = num(value, min, max);
  return n === null ? null : Math.round(n);
};
const decimal = (value, min, max, digits = 2) => {
  const n = num(value, min, max);
  return n === null ? null : Math.round(n * 10 ** digits) / 10 ** digits;
};

/** The end of the time a daily record of `day` counts as current (two days after its start, UTC). */
export const dayUntil = (day) => Date.parse(`${day}T00:00:00Z`) + 2 * DAY;

/**
 * The answers of a cycle (by collection, missing ones absent) -> the values
 * by feature role (null when not available), the day of the sleep data, and
 * the readings: by role, `{ value, key, until, createdAt? }`. `key` changes
 * only with the record (value@day, bpm@timestamp): the same record is never
 * published twice. `until`: the time it stops counting as current (never
 * published after). `createdAt`: the time of the heart rate sample.
 */
export function valuesOf(answers, now) {
  const sleepDaily = latestDaily(answers.daily_sleep, now);
  const readiness = latestDaily(answers.daily_readiness, now);
  const activity = latestDaily(answers.daily_activity, now);
  const spo2 = latestDaily(answers.daily_spo2, now);
  const sleep = mainSleep(answers.sleep, now);
  const heart = latestHeartRate(answers.heartrate ?? [], now);
  const sources = {
    sleep_score: [sleepDaily, integer(sleepDaily?.score, 0, 100)],
    readiness_score: [readiness, integer(readiness?.score, 0, 100)],
    activity_score: [activity, integer(activity?.score, 0, 100)],
    sleep_duration: [sleep, hours(sleep?.total_sleep_duration)],
    deep_sleep: [sleep, hours(sleep?.deep_sleep_duration)],
    rem_sleep: [sleep, hours(sleep?.rem_sleep_duration)],
    lowest_heart_rate: [sleep, integer(sleep?.lowest_heart_rate, 20, 250)],
    average_hrv: [sleep, integer(sleep?.average_hrv, 0, 500)],
    temperature_deviation: [readiness, decimal(readiness?.temperature_deviation, -10, 10)],
    spo2: [spo2, decimal(spo2?.spo2_percentage?.average, 50, 100, 1)],
    steps: [activity, integer(activity?.steps, 0, 500_000)],
    active_calories: [activity, integer(activity?.active_calories, 0, 50_000)],
  };
  const values = {};
  const readings = {};
  for (const [role, [record, value]] of Object.entries(sources)) {
    values[role] = value;
    if (value !== null) {
      readings[role] = { value, key: `${value}@${record.day}`, until: dayUntil(record.day) };
    }
  }
  values.heart_rate = heart?.bpm ?? null;
  if (heart) {
    const at = new Date(heart.at).toISOString();
    readings.heart_rate = {
      value: heart.bpm,
      key: `${heart.bpm}@${at}`,
      until: heart.at + TIMINGS.heartRateWindow,
      createdAt: at,
      at: heart.at,
    };
  }
  return { day: sleepDaily?.day ?? null, values, readings };
}
