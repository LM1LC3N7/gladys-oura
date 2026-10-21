// -----------------------------------------------------------------------------
// Answers of the Oura API v2 in the shapes the Home Assistant integration
// reads (daily_sleep, daily_readiness, daily_activity, sleep, daily_spo2,
// heartrate). Invented values: never checked on a real account.
// -----------------------------------------------------------------------------

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
/** 2026-10-21 08:00 UTC. */
export const NOW = Date.UTC(2026, 9, 21, 8, 0, 0);

export const CLIENT_ID = 'TESTCLIENTID0123456789';
export const CLIENT_SECRET = 'test-client-secret-value-0123';
export const GLADYS_REDIRECT = 'https://gladys.local/dashboard/integration/oauth';

const iso = (time) => new Date(time).toISOString();

/** Distinctive values: none of them may ever reach a log or /data. */
export const VALUES = {
  sleepScore: 83,
  readinessScore: 77,
  activityScore: 64,
  temperatureDeviation: -0.21,
  steps: 4321,
  activeCalories: 187,
  totalSleep: 26100,
  deepSleep: 5400,
  remSleep: 6300,
  lowestHeartRate: 49,
  averageHrv: 41,
  spo2: 96.4,
  heartRate: 61,
};

/** The collections of an account at `now` (the day of `now` and the one before). */
export function collections(now = NOW) {
  const today = iso(now).slice(0, 10);
  const yesterday = iso(now - DAY).slice(0, 10);
  return {
    daily_sleep: [
      { id: 'ds-1', day: yesterday, score: 71, contributors: { deep_sleep: 60 } },
      { id: 'ds-2', day: today, score: VALUES.sleepScore, contributors: { deep_sleep: 80 } },
    ],
    daily_readiness: [
      {
        id: 'dr-1',
        day: today,
        score: VALUES.readinessScore,
        temperature_deviation: VALUES.temperatureDeviation,
      },
    ],
    daily_activity: [
      {
        id: 'da-1',
        day: today,
        score: VALUES.activityScore,
        steps: VALUES.steps,
        active_calories: VALUES.activeCalories,
        total_calories: 2100,
      },
    ],
    sleep: [
      {
        id: 's-1',
        day: today,
        type: 'long_sleep',
        bedtime_start: iso(now - 9 * HOUR),
        bedtime_end: iso(now - HOUR),
        total_sleep_duration: VALUES.totalSleep,
        deep_sleep_duration: VALUES.deepSleep,
        rem_sleep_duration: VALUES.remSleep,
        light_sleep_duration: 14400,
        lowest_heart_rate: VALUES.lowestHeartRate,
        average_hrv: VALUES.averageHrv,
      },
      {
        id: 's-2',
        day: today,
        type: 'late_nap',
        bedtime_start: iso(now - 30 * MINUTE),
        bedtime_end: iso(now - 10 * MINUTE),
        total_sleep_duration: 1200,
        lowest_heart_rate: 55,
      },
    ],
    daily_spo2: [{ id: 'sp-1', day: today, spo2_percentage: { average: VALUES.spo2 } }],
    heartrate: [
      { bpm: 58, source: 'rest', timestamp: iso(now - 40 * MINUTE) },
      { bpm: VALUES.heartRate, source: 'rest', timestamp: iso(now - 10 * MINUTE) },
    ],
  };
}
