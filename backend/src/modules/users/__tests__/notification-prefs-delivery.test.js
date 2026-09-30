import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS, DEFAULT_NOTIFICATION_PREFS } from '@pms/shared';
import request from 'supertest';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../user.model.js';
import { createApp } from '../../../app.js';
import { generateAccessToken } from '../../auth/token.service.js';

withMemoryDb();

const config = {
  nodeEnv: 'test', isProduction: false, port: 4000, mongoUrl: 'mongodb://unused',
  frontendBaseUrl: 'http://localhost:3000', corsOrigins: ['http://localhost:3000'],
  jwt: {
    secret: 'a-sufficiently-long-test-secret-value-here',
    accessExpirationMinutes: 15, refreshExpirationDays: 30,
  },
  cookie: { domain: undefined, secure: false },
  features: { attachments: false, email: false, seed: false },
  storage: null, email: null, seed: null,
};

const app = () => createApp(config);
const member = () => User.create({
  name: 'Dev', email: `dev-${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password', status: 'active', role: ROLE_IDS.DEVELOPER,
});
const bearer = (user) => `Bearer ${generateAccessToken(user, config)}`;
const patch = (user, body) => request(app()).patch('/v1/users/me/notification-prefs')
  .set('Authorization', bearer(user)).send(body);

test('a new user carries every delivery default', async () => {
  const user = await member();
  const prefs = user.toJSON().notificationPrefs;
  assert.equal(prefs.emailFrequency, 'immediate');
  assert.equal(prefs.timeZone, 'Asia/Kolkata');
  assert.deepEqual(prefs.quietHours, DEFAULT_NOTIFICATION_PREFS.quietHours);
  assert.equal(prefs.emailPaused, false);
});

test('a user created before the delivery settings reads them as defaults', async () => {
  const user = await member();
  await User.collection.updateOne({ _id: user._id }, {
    $unset: {
      'notificationPrefs.emailFrequency': '',
      'notificationPrefs.timeZone': '',
      'notificationPrefs.quietHours': '',
      'notificationPrefs.emailPaused': '',
    },
  });
  const prefs = (await User.findById(user._id)).toJSON().notificationPrefs;
  assert.equal(prefs.emailFrequency, 'immediate');
  assert.equal(prefs.timeZone, 'Asia/Kolkata');
  assert.equal(prefs.quietHours.start, '22:00');
});

test('delivery settings save alongside the event maps, quiet hours partially', async () => {
  const user = await member();

  const res = await patch(user, {
    emailFrequency: 'daily',
    timeZone: 'America/New_York',
    quietHours: { enabled: true, start: '23:30' },
    emailPaused: true,
    email: { TICKET_COMMENTED: true },
  }).expect(200);

  const prefs = res.body.notificationPrefs;
  assert.equal(prefs.emailFrequency, 'daily');
  assert.equal(prefs.timeZone, 'America/New_York');
  assert.deepEqual(prefs.quietHours, {
    enabled: true, start: '23:30', end: '08:00', allowUrgent: true,
  });
  assert.equal(prefs.emailPaused, true);
  assert.equal(prefs.email.TICKET_COMMENTED, true);
  assert.equal(prefs.inApp.TICKET_CLOSED, true, 'untouched keys keep their value');

  const again = await patch(user, { quietHours: { allowUrgent: false } }).expect(200);
  assert.equal(again.body.notificationPrefs.quietHours.start, '23:30');
  assert.equal(again.body.notificationPrefs.quietHours.allowUrgent, false);
});

test('bad delivery settings are rejected', async () => {
  const user = await member();
  for (const body of [
    { emailFrequency: 'weekly' },
    { timeZone: 'Mars/Olympus_Mons' },
    { timeZone: '' },
    { quietHours: { start: '25:00' } },
    { quietHours: { end: '8:00' } },
    { quietHours: {} },
    { quietHours: { enabled: true, colour: 'blue' } },
    { emailPaused: 'yes please' },
    {},
  ]) {
    const res = await patch(user, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  }
});

test('reset restores the delivery defaults too', async () => {
  const user = await member();
  await patch(user, {
    emailFrequency: 'hourly', timeZone: 'Europe/London', quietHours: { enabled: true }, emailPaused: true,
  }).expect(200);

  const res = await request(app()).post('/v1/users/me/notification-prefs/reset')
    .set('Authorization', bearer(user)).expect(200);

  const prefs = res.body.notificationPrefs;
  assert.equal(prefs.emailFrequency, 'immediate');
  assert.equal(prefs.timeZone, 'Asia/Kolkata');
  assert.deepEqual(prefs.quietHours, DEFAULT_NOTIFICATION_PREFS.quietHours);
  assert.equal(prefs.emailPaused, false);
});
