import { DEFAULT_NOTIFICATION_PREFS } from '@pms/shared';

/**
 * When a person's ticket mail may go out: their hourly/daily slot and their
 * quiet hours, read in their own time zone. Built on Intl alone — the offset
 * of a zone at an instant is read back from a formatter, so DST is whatever
 * the runtime's tz database says it is.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAILY_HOUR = 9;

// The organisation's zone (DEFAULT_TIME_ZONE), set once at boot by createApp.
// A module value rather than a config read because the User schema default
// needs it and has no config in hand. Tests that never boot the app get the
// shared default.
let organisationTimeZone = DEFAULT_NOTIFICATION_PREFS.timeZone;
export function setDefaultTimeZone(tz) {
  if (isValidTimeZone(tz)) organisationTimeZone = tz;
}
export function defaultTimeZone() {
  return organisationTimeZone;
}

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map();
function formatterFor(tz) {
  if (!formatters.has(tz)) {
    formatters.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    }));
  }
  return formatters.get(tz);
}

/** Wall-clock fields of `date` in `tz` (month is 1-12). */
export function zonedParts(date, tz) {
  const parts = {};
  for (const { type, value } of formatterFor(tz).formatToParts(date)) {
    if (type !== 'literal') parts[type] = Number(value);
  }
  return parts;
}

/** Milliseconds `tz` is ahead of UTC at `date` (+05:30 -> 19800000). */
function offsetAt(date, tz) {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - (Math.floor(date.getTime() / 1000) * 1000);
}

/**
 * The instant a wall-clock time in `tz` happens. The offset is read twice
 * because the first guess can sit on the other side of a DST change. A time
 * that does not exist (the skipped hour of spring-forward) lands an hour off,
 * which only matters for slots in that hour; ours are 09:00, the top of an
 * hour, and quiet-hours ends.
 */
export function zonedTimeToUtc({
  year, month, day, hour = 0, minute = 0,
}, tz) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = offsetAt(new Date(guess), tz);
  const second = offsetAt(new Date(guess - first), tz);
  return new Date(guess - second);
}

/** The next local calendar day, rolled through Date.UTC so month ends work. */
function nextDay({ year, month, day }) {
  const d = new Date(Date.UTC(year, month - 1, day + 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * The next top of the hour in `tz`. Measured from the local minute, not the UTC
 * one: in Asia/Kolkata the local hour turns at :30 UTC. Assumes offsets change
 * by whole hours across DST, true everywhere except Lord Howe Island (30 min).
 */
export function nextTopOfHour(now, tz) {
  const p = zonedParts(now, tz);
  const intoHour = (p.minute * 60 + p.second) * 1000 + now.getMilliseconds();
  return new Date(now.getTime() - intoHour + HOUR_MS);
}

/** The next `hour`:00 local time strictly after `now` (09:00 for the daily summary). */
export function nextDailySlot(now, tz, hour = DAILY_HOUR) {
  const p = zonedParts(now, tz);
  let slot = zonedTimeToUtc({ ...p, hour, minute: 0 }, tz);
  if (slot <= now) slot = zonedTimeToUtc({ ...nextDay(p), hour, minute: 0 }, tz);
  return slot;
}

function minutesOf(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

/**
 * If `at` falls inside the quiet window, the instant it ends; otherwise null.
 * The window may cross midnight (22:00 -> 08:00). start === end is an empty
 * window, not a 24-hour one — "never quiet" is the safer reading of a typo.
 */
export function quietHoursEnd(quietHours, tz, at) {
  if (!quietHours?.enabled) return null;
  const start = minutesOf(quietHours.start);
  const end = minutesOf(quietHours.end);
  if (start === end) return null;

  const p = zonedParts(at, tz);
  const now = p.hour * 60 + p.minute;
  const inside = start < end ? now >= start && now < end : now >= start || now < end;
  if (!inside) return null;

  // Before `end` on the same local day (the morning half, or a same-day
  // window), or else the next day's `end` (the evening half).
  const day = now < end ? p : nextDay(p);
  const endAt = zonedTimeToUtc({ ...day, hour: Math.floor(end / 60), minute: end % 60 }, tz);
  return endAt > at ? endAt : null;
}

/**
 * The delivery settings a send decision reads, with every gap filled from the
 * defaults. Rows written before these settings existed have none of them.
 */
export function deliveryPrefs(user, config = {}) {
  const prefs = user?.notificationPrefs ?? {};
  const quiet = prefs.quietHours ?? {};
  const defaults = DEFAULT_NOTIFICATION_PREFS;
  const tz = isValidTimeZone(prefs.timeZone) ? prefs.timeZone : (config.defaultTimeZone || organisationTimeZone);
  return {
    emailFrequency: prefs.emailFrequency || defaults.emailFrequency,
    timeZone: tz,
    quietHours: {
      enabled: quiet.enabled ?? defaults.quietHours.enabled,
      start: quiet.start || defaults.quietHours.start,
      end: quiet.end || defaults.quietHours.end,
      allowUrgent: quiet.allowUrgent ?? defaults.quietHours.allowUrgent,
    },
    emailPaused: prefs.emailPaused === true,
  };
}

/** The end of the recipient's quiet hours if they are in them at `at`, else null. */
export function quietUntil(user, config, at = new Date()) {
  const prefs = deliveryPrefs(user, config);
  return quietHoursEnd(prefs.quietHours, prefs.timeZone, at);
}

/**
 * When a routine email for this person may go out, or null for "the usual
 * batch window". Hourly and daily hold it for their next slot; quiet hours
 * hold it (or that slot) until they end. `candidate` is when the batch would
 * otherwise go out, so a batch opened a minute before quiet hours start is
 * held too.
 */
export function routineHoldUntil(user, config, now = new Date(), candidate = now) {
  const prefs = deliveryPrefs(user, config);
  let slot = null;
  if (prefs.emailFrequency === 'hourly') slot = nextTopOfHour(now, prefs.timeZone);
  if (prefs.emailFrequency === 'daily') slot = nextDailySlot(now, prefs.timeZone);
  const at = slot ?? candidate;
  return quietHoursEnd(prefs.quietHours, prefs.timeZone, at) ?? slot;
}
