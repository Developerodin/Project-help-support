import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { ROLE_IDS, DEFAULT_NOTIFICATION_PREFS } from '@pms/shared';
import {
  startTestDb,
  stopTestDb,
  createTestApp,
  createActiveUser,
  bearerToken,
  getTestConfig,
} from '../../../test/test-harness.js';

describe('notification prefs reset', () => {
  let app;
  let config;
  let user;

  before(async () => {
    await startTestDb();
    app = createTestApp();
    config = getTestConfig();
    user = await createActiveUser({
      email: 'prefs-reset@example.com',
      roles: [ROLE_IDS.DEVELOPER],
    });
  });

  after(async () => {
    await stopTestDb();
  });

  it('restores default notification preferences', async () => {
    const auth = bearerToken(user, config);
    await request(app)
      .patch('/v1/users/me/notification-prefs')
      .set('Authorization', auth)
      .send({ email: { TICKET_CREATED: false }, inApp: { TICKET_ASSIGNED: false } });

    const resetRes = await request(app)
      .post('/v1/users/me/notification-prefs/reset')
      .set('Authorization', auth);
    assert.equal(resetRes.status, 200);
    assert.equal(resetRes.body.notificationPrefs.email.TICKET_CREATED, DEFAULT_NOTIFICATION_PREFS.email.TICKET_CREATED);
    assert.equal(resetRes.body.notificationPrefs.inApp.TICKET_ASSIGNED, DEFAULT_NOTIFICATION_PREFS.inApp.TICKET_ASSIGNED);
  });
});
