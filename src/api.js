// -----------------------------------------------------------------------------
// The calls of the Oura API v2 (GET, read only), as the Home Assistant
// integration makes them (api.py): one collection per request, a range of
// days (`start_date`, `end_date`) or of times for the heart rate
// (`start_datetime`, `end_datetime`), the next page by `next_token`.
// -----------------------------------------------------------------------------

import { API_BASE, DAY } from './constants.js';
import { OuraError, apiError, parseJson } from './http.js';

/** The UTC day (YYYY-MM-DD) of a time. */
export const isoDay = (time) => new Date(time).toISOString().slice(0, 10);

/**
 * The query of a collection at `now`: three days for the daily collections
 * (the day before yesterday to tomorrow, UTC: the day of a record is the
 * local day of the ring, up to 14 hours away from UTC); the last `window`
 * for the heart rate.
 */
export function queryOf(name, now, window) {
  if (name === 'heartrate') {
    return {
      start_datetime: new Date(now - window).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      end_datetime: new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      // Only what is read (as the Home Assistant integration): smaller pages.
      fields: 'timestamp,bpm',
    };
  }
  return { start_date: isoDay(now - 2 * DAY), end_date: isoDay(now + DAY) };
}

/**
 * One page of a collection: the JSON answer (an object), or an OuraError by
 * status (401 `unauthorized`, 403 `forbidden`, 429, 5xx, other `http`).
 */
export async function getCollection(transport, name, query, { token, now, timeout }) {
  const res = await transport(`${API_BASE}/${name}?${new URLSearchParams(query)}`, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    timeout,
  });
  const error = apiError(res, now);
  if (error) {
    throw error;
  }
  const data = parseJson(res.body);
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.data)) {
    throw new OuraError('bad_response', 'Oura sent an answer without data');
  }
  return data;
}
