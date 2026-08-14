import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTIFICATION_EVENTS,
  DEFAULT_NOTIFICATION_PREFS,
  NOTIFICATION_EVENT_LABELS,
  notificationEventLabel,
} from '../notification-events.js';

test('event keys are frozen, unique and SCREAMING_SNAKE_CASE', () => {
  assert.ok(Object.isFrozen(NOTIFICATION_EVENTS));
  assert.equal(new Set(NOTIFICATION_EVENTS).size, NOTIFICATION_EVENTS.length);
  for (const key of NOTIFICATION_EVENTS) {
    assert.match(key, /^[A-Z][A-Z0-9_]*$/, `${key} is not SCREAMING_SNAKE_CASE`);
  }
});

test('every event has an explicit default for both channels', () => {
  for (const key of NOTIFICATION_EVENTS) {
    assert.equal(typeof DEFAULT_NOTIFICATION_PREFS.email[key], 'boolean',
      `missing email default for ${key}`);
    assert.equal(typeof DEFAULT_NOTIFICATION_PREFS.inApp[key], 'boolean',
      `missing inApp default for ${key}`);
  }
});

test('defaults contain no keys that are not real events', () => {
  const known = new Set(NOTIFICATION_EVENTS);
  for (const channel of ['email', 'inApp']) {
    for (const key of Object.keys(DEFAULT_NOTIFICATION_PREFS[channel])) {
      assert.ok(known.has(key), `${channel} default references unknown event ${key}`);
    }
  }
});

test('every event has a human-readable label without underscores', () => {
  assert.ok(Object.isFrozen(NOTIFICATION_EVENT_LABELS));
  for (const key of NOTIFICATION_EVENTS) {
    const label = NOTIFICATION_EVENT_LABELS[key];
    assert.equal(typeof label, 'string', `missing label for ${key}`);
    assert.doesNotMatch(label, /_/, `${key} label should not contain underscores`);
    assert.equal(notificationEventLabel(key), label);
  }
  assert.equal(notificationEventLabel('UNKNOWN_EVENT'), 'UNKNOWN_EVENT');
});

test('in-app defaults are all on; the two high-volume events default email off', () => {
  for (const key of NOTIFICATION_EVENTS) {
    assert.equal(DEFAULT_NOTIFICATION_PREFS.inApp[key], true, `${key} inApp should default on`);
  }
  assert.equal(DEFAULT_NOTIFICATION_PREFS.email.TICKET_COMMENTED, false);
  assert.equal(DEFAULT_NOTIFICATION_PREFS.email.TICKET_ESTIMATE_SET, false);
  assert.equal(DEFAULT_NOTIFICATION_PREFS.email.TICKET_ASSIGNED, true);
});
