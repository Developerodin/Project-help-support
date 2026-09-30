import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidTimeZone, nextDailySlot, nextTopOfHour, quietHoursEnd, routineHoldUntil, zonedTimeToUtc,
} from '../delivery-schedule.js';

const at = (iso) => new Date(iso);
const iso = (date) => date?.toISOString() ?? null;

test('time zones are validated through Intl', () => {
  assert.equal(isValidTimeZone('America/New_York'), true);
  assert.equal(isValidTimeZone('Asia/Kolkata'), true);
  assert.equal(isValidTimeZone('Mars/Olympus_Mons'), false);
  assert.equal(isValidTimeZone(''), false);
  assert.equal(isValidTimeZone(null), false);
});

test('local wall-clock times convert to the right instant on both sides of DST', () => {
  // New York: EST (-5) until 2026-03-08 02:00, EDT (-4) after; back on 2026-11-01.
  assert.equal(iso(zonedTimeToUtc({ year: 2026, month: 3, day: 7, hour: 9 }, 'America/New_York')), '2026-03-07T14:00:00.000Z');
  assert.equal(iso(zonedTimeToUtc({ year: 2026, month: 3, day: 8, hour: 9 }, 'America/New_York')), '2026-03-08T13:00:00.000Z');
  assert.equal(iso(zonedTimeToUtc({ year: 2026, month: 11, day: 1, hour: 9 }, 'America/New_York')), '2026-11-01T14:00:00.000Z');
});

test('the next top of the hour is local, including half-hour zones and the DST jump', () => {
  // 15:40 IST -> 16:00 IST, which is :30 past a UTC hour.
  assert.equal(iso(nextTopOfHour(at('2026-09-25T10:10:00Z'), 'Asia/Kolkata')), '2026-09-25T10:30:00.000Z');
  // 01:30 EST on spring-forward night: the next local hour is 03:00 EDT, 30 minutes later.
  assert.equal(iso(nextTopOfHour(at('2026-03-08T06:30:00Z'), 'America/New_York')), '2026-03-08T07:00:00.000Z');
  // Exactly on the hour moves to the next one, never "now".
  assert.equal(iso(nextTopOfHour(at('2026-09-25T10:30:00Z'), 'Asia/Kolkata')), '2026-09-25T11:30:00.000Z');
});

test('the daily slot is the next 09:00 local, across DST changes', () => {
  // Sat 15:00 EST -> Sun 09:00, which is already EDT.
  assert.equal(iso(nextDailySlot(at('2026-03-07T20:00:00Z'), 'America/New_York')), '2026-03-08T13:00:00.000Z');
  // Sat 22:00 EDT -> Sun 09:00, which is already EST.
  assert.equal(iso(nextDailySlot(at('2026-11-01T02:00:00Z'), 'America/New_York')), '2026-11-01T14:00:00.000Z');
  // 07:00 local -> 09:00 the same day.
  assert.equal(iso(nextDailySlot(at('2026-09-25T01:30:00Z'), 'Asia/Kolkata')), '2026-09-25T03:30:00.000Z');
  // 09:00 exactly -> tomorrow.
  assert.equal(iso(nextDailySlot(at('2026-09-25T03:30:00Z'), 'Asia/Kolkata')), '2026-09-26T03:30:00.000Z');
});

test('quiet hours that cross midnight end the following morning', () => {
  const quiet = { enabled: true, start: '22:00', end: '08:00' };
  const tz = 'Asia/Kolkata';
  // 22:30 IST -> 08:00 IST tomorrow.
  assert.equal(iso(quietHoursEnd(quiet, tz, at('2026-09-25T17:00:00Z'))), '2026-09-26T02:30:00.000Z');
  // 05:30 IST -> 08:00 IST today.
  assert.equal(iso(quietHoursEnd(quiet, tz, at('2026-09-25T00:00:00Z'))), '2026-09-25T02:30:00.000Z');
  // 11:30 IST: not quiet.
  assert.equal(quietHoursEnd(quiet, tz, at('2026-09-25T06:00:00Z')), null);
  // The end minute itself is outside the window.
  assert.equal(quietHoursEnd(quiet, tz, at('2026-09-25T02:30:00Z')), null);
  // Disabled, or an empty window.
  assert.equal(quietHoursEnd({ ...quiet, enabled: false }, tz, at('2026-09-25T17:00:00Z')), null);
  assert.equal(quietHoursEnd({ enabled: true, start: '09:00', end: '09:00' }, tz, at('2026-09-25T17:00:00Z')), null);
});

test('same-day quiet hours and a DST zone', () => {
  // 12:00-14:00 New York, on the day clocks go back: 13:00 EST -> 14:00 EST.
  const lunch = { enabled: true, start: '12:00', end: '14:00' };
  assert.equal(iso(quietHoursEnd(lunch, 'America/New_York', at('2026-11-01T18:00:00Z'))), '2026-11-01T19:00:00.000Z');
});

test('the routine hold combines the frequency slot with quiet hours', () => {
  const user = (prefs) => ({ notificationPrefs: { timeZone: 'Asia/Kolkata', ...prefs } });
  const now = at('2026-09-25T10:10:00Z'); // 15:40 IST

  assert.equal(routineHoldUntil(user({ emailFrequency: 'immediate' }), {}, now), null);
  assert.equal(iso(routineHoldUntil(user({ emailFrequency: 'hourly' }), {}, now)), '2026-09-25T10:30:00.000Z');
  assert.equal(iso(routineHoldUntil(user({ emailFrequency: 'daily' }), {}, now)), '2026-09-26T03:30:00.000Z');

  // An hourly slot inside quiet hours waits for them to end.
  const late = at('2026-09-25T16:40:00Z'); // 22:10 IST, next slot 23:00 IST
  const quiet = { enabled: true, start: '22:00', end: '08:00', allowUrgent: true };
  assert.equal(iso(routineHoldUntil(user({ emailFrequency: 'hourly', quietHours: quiet }), {}, late)), '2026-09-26T02:30:00.000Z');
  // An immediate reader is held when the batch would go out inside them.
  const beforeQuiet = at('2026-09-25T16:28:00Z'); // 21:58 IST, batch due 22:03
  const due = new Date(beforeQuiet.getTime() + 5 * 60 * 1000);
  assert.equal(iso(routineHoldUntil(user({ quietHours: quiet }), {}, beforeQuiet, due)), '2026-09-26T02:30:00.000Z');
  // A daily 09:00 slot already after an 08:00 end is left alone.
  assert.equal(iso(routineHoldUntil(user({ emailFrequency: 'daily', quietHours: quiet }), {}, late)), '2026-09-26T03:30:00.000Z');
});
