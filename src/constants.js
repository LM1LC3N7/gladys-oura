// -----------------------------------------------------------------------------
// Manifest keys, Oura constants, limits and timings.
//
// The authorization page, the token endpoints, the scopes and the paths of
// the Oura API v2 are those of oura-ring (MIT, hedgertronic, 1.0.1: auth.py,
// client.py) and of the Home Assistant integration Oura-Home-Assistant-
// Integration (MIT, louispires: const.py, api.py, application_credentials.py).
// -----------------------------------------------------------------------------

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** The authorization page of Oura (the user signs in there, never here). */
export const AUTHORIZE_URL = 'https://cloud.ouraring.com/oauth/authorize';

/**
 * The token endpoints. `api`: the one of the Oura documentation (oura-ring);
 * `moi`: the one the Home Assistant integration uses for the apps of the new
 * developer portal. Chosen in the configuration, never tried one after the
 * other (an authorization code serves once).
 */
export const TOKEN_URLS = {
  api: 'https://api.ouraring.com/oauth/token',
  moi: 'https://moi.ouraring.com/oauth/v2/ext/oauth-token',
};

/** The API v2, read only. */
export const API_BASE = 'https://api.ouraring.com/v2/usercollection';

/**
 * The scopes asked: only what the features need (no e-mail, no personal
 * information, no workout, tag or session).
 */
export const SCOPES = ['daily', 'heartrate', 'spo2Daily'];

/**
 * The collections read at each cycle, in this order. The first one is the
 * primary: its failure is the failure of the cycle. The others are
 * secondary: a refusal (scope not granted, ring or membership without the
 * feature), a 5xx or a timeout only leaves their values out this time.
 */
export const COLLECTIONS = [
  'daily_sleep',
  'daily_readiness',
  'daily_activity',
  'sleep',
  'daily_spo2',
  'heartrate',
];
export const PRIMARY = 'daily_sleep';

/** The `oauth2` field of the manifest `config_schema` (the Connect button). */
export const OAUTH_FIELD = 'account';

export const ACTIONS = {
  FINISH_SIGN_IN: 'finish_sign_in',
  TEST_CONNECTION: 'test_connection',
};

/** Refresh interval, in minutes: the ring sends its data when the phone app syncs. */
export const POLL_MINUTES = { min: 15, max: 240, default: 30 };

/** The device type of the external ids: one device per Oura app (client id). */
export const DEVICE_TYPE = 'ring';

export const TIMINGS = {
  requestTimeout: 15 * SECOND,
  /** A button waits less (actions time out after 60 s). */
  quickTimeout: 10 * SECOND,
  /** The code exchange of Gladys' OAuth return: Gladys waits for its answer. */
  callbackTimeout: 3500,
  /** A pause after an ordinary error, kept in /data, read back capped at this. */
  backoffMax: 2 * HOUR,
  /** Renewed this long before its end (at most half of its lifetime). */
  tokenMargin: 10 * MINUTE,
  /** Never two renewals within a minute (a token shorter than the margin, a clock ahead). */
  renewFloor: MINUTE,
  /** A renewal that did not reach Oura: tried again after 1, 5, 15, then 60 minutes. */
  renewRetry: [MINUTE, 5 * MINUTE, 15 * MINUTE, HOUR],
  /** Without an expiry in the answer, the token is renewed after this. */
  defaultTokenLife: HOUR,
  /** 429: Retry-After when given, within 1 minute and 6 hours; 15 minutes without it. */
  rateLimitMin: MINUTE,
  rateLimitMax: 6 * HOUR,
  rateLimitDefault: 15 * MINUTE,
  /** 5xx: 5, 15, 30, then 60 minutes (never sooner than the interval). */
  unavailable: [5 * MINUTE, 15 * MINUTE, 30 * MINUTE, HOUR],
  /** 403 on the main data: the membership needed by the API; read again after 6 hours. */
  forbidden: 6 * HOUR,
  /** Other failures: never sooner than the interval, then 15, 30, 60 minutes. */
  backoff: [15 * MINUTE, 30 * MINUTE, HOUR],
  /** A sign-in started (Connect) can be finished for 15 minutes. */
  signInTtl: 15 * MINUTE,
  testCooldown: 30 * SECOND,
  /** An unchanged state is sent again every hour. */
  stateHeartbeat: HOUR,
  flushInterval: SECOND,
  /** The heart rate read: the last 3 hours; an older sample is never published. */
  heartRateWindow: 3 * HOUR,
};

export const LIMITS = {
  /** Gladys: 300 states per minute; a margin is kept. */
  statesPerMinute: 250,
  statesPerRequest: 100,
  /** Three days of sleep periods (with their 5-minute series) stay far below. */
  responseBytes: 2 * 1024 * 1024,
  /** Records read in one answer (three days are asked: a few records). */
  records: 200,
  /** Pages of heart rate followed (next_token) at most per cycle. */
  heartRatePages: 3,
  signIns: 5,
  /**
   * Requests sent to Oura per UTC day, sign-in and renewals included: at most
   * 8 per cycle, 96 cycles a day at the fastest pace. Reached (a loop, a
   * bug), every path waits for the next UTC day. Oura allows far more
   * (5,000 requests per 5 minutes).
   */
  dailyRequests: 1000,
  /** Authorization codes, tokens: bounded before they are kept. */
  codeLength: 4096,
  tokenLength: 16384,
  pastedLength: 8192,
};
