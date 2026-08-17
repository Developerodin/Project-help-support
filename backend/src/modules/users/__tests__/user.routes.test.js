import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS } from '@pms/shared';
import request from 'supertest';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../user.model.js';
import Project from '../../projects/project.model.js';
import Ticket from '../../tickets/ticket.model.js';
import * as userService from '../user.service.js';
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

const sent = [];
const app = () => createApp(config, {
  deliverInvite: async (payload) => { sent.push(payload); },
});

const make = (role) => User.create({
  name: role, email: `${role}-${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password', status: 'active', role,
});

const bearer = (user) => `Bearer ${generateAccessToken(user, config)}`;

test('POST /v1/users is admin-only', async () => {
  const lead = await make(ROLE_IDS.PROJECT_ADMIN);

  const res = await request(app()).post('/v1/users')
    .set('Authorization', bearer(lead))
    .send({ email: 'new@example.com', role: 'developer' })
    .expect(403);

  assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('POST /v1/users creates an invited user and hands the token to the deliverer', async () => {
  sent.length = 0;
  const admin = await make(ROLE_IDS.ADMIN);

  const res = await request(app()).post('/v1/users')
    .set('Authorization', bearer(admin))
    .send({ email: '  New@Example.COM ', role: 'developer' })
    .expect(201);

  assert.equal(res.body.email, 'new@example.com');
  assert.equal(res.body.name, '');
  assert.equal(res.body.status, 'invited');
  assert.equal(res.body.inviteToken, undefined, 'the token is never in the response body');

  assert.equal(sent.length, 1);
  assert.ok(sent[0].inviteToken);
  assert.equal(sent[0].user.email, 'new@example.com');
});

test('PATCH /v1/users/:id deactivates without removing the user', async () => {
  const admin = await make(ROLE_IDS.ADMIN);
  const target = await make(ROLE_IDS.DEVELOPER);

  await request(app()).patch(`/v1/users/${target._id}`)
    .set('Authorization', bearer(admin))
    .send({ status: 'inactive' })
    .expect(200);

  assert.equal((await User.findById(target._id)).status, 'inactive');
});

test('DELETE /v1/users/:id scrubs PII and revokes access', async () => {
  const admin = await make(ROLE_IDS.ADMIN);
  const target = await make(ROLE_IDS.DEVELOPER);

  await request(app()).delete(`/v1/users/${target._id}`)
    .set('Authorization', bearer(admin))
    .expect(200);

  const scrubbed = await User.findById(target._id);
  assert.equal(scrubbed.name, 'Deleted User');
  assert.equal(scrubbed.email, `deleted+${target._id}@internal`);
  assert.equal(scrubbed.status, 'inactive');
});

test('DELETE /v1/users/:id clears active ticket assignments', async () => {
  const admin = await make(ROLE_IDS.ADMIN);
  const target = await make(ROLE_IDS.DEVELOPER);
  const project = await Project.create({ key: 'DEL', name: 'Delete test', createdBy: admin._id });
  await Ticket.create({
    ticketId: 'DEL-1', project: project._id, title: 'Assigned ticket',
    createdBy: admin._id, assignedTo: target._id, status: 'pending',
  });

  await request(app()).delete(`/v1/users/${target._id}`)
    .set('Authorization', bearer(admin))
    .expect(200);

  const ticket = await Ticket.findOne({ ticketId: 'DEL-1' });
  assert.equal(ticket.assignedTo, null);
});

test('an admin cannot delete themselves', async () => {
  const admin = await make(ROLE_IDS.ADMIN);

  const res = await request(app()).delete(`/v1/users/${admin._id}`)
    .set('Authorization', bearer(admin))
    .expect(400);

  assert.equal(res.body.error.code, 'CANNOT_DELETE_SELF');
});

test('an admin cannot delete the last admin', async () => {
  const soleAdmin = await make(ROLE_IDS.ADMIN);
  const actor = await make(ROLE_IDS.DEVELOPER);

  await assert.rejects(
    () => userService.deleteUser(actor, soleAdmin._id),
    (err) => {
      assert.equal(err.code, 'LAST_ADMIN');
      return true;
    },
  );
});

test('an admin cannot demote or deactivate themselves', async () => {
  const admin = await make(ROLE_IDS.ADMIN);

  const demote = await request(app()).patch(`/v1/users/${admin._id}`)
    .set('Authorization', bearer(admin))
    .send({ role: ROLE_IDS.DEVELOPER })
    .expect(400);
  assert.equal(demote.body.error.code, 'CANNOT_MODIFY_SELF');

  await request(app()).patch(`/v1/users/${admin._id}`)
    .set('Authorization', bearer(admin))
    .send({ status: 'inactive' })
    .expect(400);
});

test('POST /v1/users rejects an inactive email with USER_INACTIVE', async () => {
  const admin = await make(ROLE_IDS.ADMIN);
  await User.create({
    name: 'Former', email: 'former@example.com', password: 'a-long-enough-password', status: 'inactive',
  });

  const res = await request(app()).post('/v1/users')
    .set('Authorization', bearer(admin))
    .send({ email: 'former@example.com', role: 'developer' })
    .expect(400);

  assert.equal(res.body.error.code, 'USER_INACTIVE');
  assert.match(res.body.error.message, /deactivated/i);
});

test('resend-invite returns sent=true for invited users and sent=false otherwise', async () => {
  const admin = await make(ROLE_IDS.ADMIN);
  const invited = await User.create({
    name: 'Pending', email: 'pending@example.com', password: 'a-long-enough-password',
    status: 'invited',
  });
  const active = await make(ROLE_IDS.DEVELOPER);

  const invitedRes = await request(app()).post(`/v1/users/${invited._id}/resend-invite`)
    .set('Authorization', bearer(admin)).expect(200);
  const missingRes = await request(app()).post('/v1/users/507f1f77bcf86cd799439011/resend-invite')
    .set('Authorization', bearer(admin)).expect(200);
  const activeRes = await request(app()).post(`/v1/users/${active._id}/resend-invite`)
    .set('Authorization', bearer(admin)).expect(200);

  assert.deepEqual(invitedRes.body, { status: 'ok', sent: true });
  assert.deepEqual(missingRes.body, { status: 'ok', sent: false });
  assert.deepEqual(activeRes.body, { status: 'ok', sent: false });
});

test('a user updates their own notification preferences', async () => {
  const member = await make(ROLE_IDS.DEVELOPER);

  const res = await request(app()).patch('/v1/users/me/notification-prefs')
    .set('Authorization', bearer(member))
    .send({ email: { TICKET_COMMENTED: true }, inApp: { TICKET_CLOSED: false } })
    .expect(200);

  assert.equal(res.body.notificationPrefs.email.TICKET_COMMENTED, true);
  assert.equal(res.body.notificationPrefs.inApp.TICKET_CLOSED, false);
});

test('an unknown event key in preferences is rejected', async () => {
  const member = await make(ROLE_IDS.DEVELOPER);

  const res = await request(app()).patch('/v1/users/me/notification-prefs')
    .set('Authorization', bearer(member))
    .send({ email: { TICKET_TELEPORTED: true } })
    .expect(400);

  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('GET /v1/users filters by role and by q', async () => {
  const admin = await make(ROLE_IDS.ADMIN);
  await make(ROLE_IDS.TESTER);

  const byRole = await request(app()).get('/v1/users?role=' + ROLE_IDS.TESTER)
    .set('Authorization', bearer(admin)).expect(200);
  assert.equal(byRole.body.results.length, 1);

  const byQuery = await request(app()).get(`/v1/users?q=${encodeURIComponent(admin.email)}`)
    .set('Authorization', bearer(admin)).expect(200);
  assert.equal(byQuery.body.results.length, 1);
});
