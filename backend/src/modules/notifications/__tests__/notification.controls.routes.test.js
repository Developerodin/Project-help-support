import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS } from '@pms/shared';
import request from 'supertest';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import Ticket from '../../tickets/ticket.model.js';
import TicketMute from '../ticketMute.model.js';
import { createApp } from '../../../app.js';
import { generateAccessToken } from '../../auth/token.service.js';
import { maskEmail, unsubscribeToken, verifyUnsubscribeToken } from '../unsubscribe.js';

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

const make = (role, extra = {}) => User.create({
  name: role, email: `${role}-${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password', status: 'active', role, ...extra,
});
const bearer = (user) => `Bearer ${generateAccessToken(user, config)}`;

async function ticketFor(reporter) {
  const project = await Project.create({ key: 'WEB', name: 'Web App', createdBy: reporter._id });
  return Ticket.create({ ticketId: 'WEB-1', project: project._id, title: 'Broken login', createdBy: reporter._id });
}

test('unsubscribe tokens verify for their user only, and reject tampering', async () => {
  const id = '6ab63d5aa078a6101c4c30af';
  const token = unsubscribeToken(id, config);

  assert.match(token, /^v1\.6ab63d5aa078a6101c4c30af\.[A-Za-z0-9_-]+$/);
  assert.equal(verifyUnsubscribeToken(token, config), id);
  assert.equal(verifyUnsubscribeToken(token.replace(id, '6ab63d5aa078a6101c4c30b0'), config), null);
  assert.equal(verifyUnsubscribeToken(`${token.slice(0, -2)}xx`, config), null);
  assert.equal(verifyUnsubscribeToken(token.replace(/^v1/, 'v2'), config), null);
  assert.equal(verifyUnsubscribeToken(token, { jwt: { secret: 'another-secret-entirely-different' } }), null);
  assert.equal(verifyUnsubscribeToken('garbage', config), null);
  assert.equal(maskEmail('prakhar@example.com'), 'p***@example.com');
});

test('GET shows the masked address and state without changing it; POST pauses and resumes', async () => {
  const member = await make(ROLE_IDS.DEVELOPER, { email: 'prakhar@example.com' });
  const token = encodeURIComponent(unsubscribeToken(member._id, config));

  const look = await request(app()).get(`/v1/notifications/email/unsubscribe?token=${token}`).expect(200);
  assert.deepEqual(look.body, { email: 'p***@example.com', paused: false });
  assert.equal((await User.findById(member._id)).notificationPrefs.emailPaused, false);

  // What a mail provider sends for one-click (RFC 8058): a form body, no session.
  await request(app()).post(`/v1/notifications/email/unsubscribe?token=${token}`)
    .type('form').send('List-Unsubscribe=One-Click').expect(204);
  assert.equal((await User.findById(member._id)).notificationPrefs.emailPaused, true);
  assert.equal((await request(app()).get(`/v1/notifications/email/unsubscribe?token=${token}`)).body.paused, true);

  await request(app()).post(`/v1/notifications/email/resubscribe?token=${token}`).expect(204);
  assert.equal((await User.findById(member._id)).notificationPrefs.emailPaused, false);
});

test('a bad unsubscribe token is a generic 400', async () => {
  const member = await make(ROLE_IDS.DEVELOPER);
  const forged = unsubscribeToken(member._id, { jwt: { secret: 'not-the-server-secret-at-all-xx' } });

  for (const token of [forged, 'v1.nope.nope', `v1.${'a'.repeat(24)}.${'b'.repeat(43)}`]) {
    const res = await request(app()).post(`/v1/notifications/email/unsubscribe?token=${encodeURIComponent(token)}`);
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_UNSUBSCRIBE_LINK');
  }
  await request(app()).get('/v1/notifications/email/unsubscribe').expect(400);
  // A valid signature for a user who no longer exists reads the same.
  const ghost = unsubscribeToken('6ab63d5aa078a6101c4c30af', config);
  await request(app()).get(`/v1/notifications/email/unsubscribe?token=${encodeURIComponent(ghost)}`).expect(400);
  assert.equal((await User.findById(member._id)).notificationPrefs.emailPaused, false);
});

test('ticket settings: the raiser follows by role, and can mute', async () => {
  const reporter = await make(ROLE_IDS.DEVELOPER);
  const ticket = await ticketFor(reporter);
  const url = `/v1/notifications/ticket-settings/${ticket._id}`;

  const initial = await request(app()).get(url).set('Authorization', bearer(reporter)).expect(200);
  assert.deepEqual(initial.body, {
    muted: false, following: true, canFollow: false, inAudienceByRole: true,
  });

  const muted = await request(app()).put(url).set('Authorization', bearer(reporter))
    .send({ muted: true }).expect(200);
  assert.equal(muted.body.muted, true);
  assert.equal(await TicketMute.countDocuments({ user: reporter._id, ticket: ticket._id }), 1);

  await request(app()).put(url).set('Authorization', bearer(reporter)).send({ muted: false }).expect(200);
  assert.equal(await TicketMute.countDocuments({}), 0);
});

test('ticket settings: following is the ticket watcher list', async () => {
  const reporter = await make(ROLE_IDS.DEVELOPER);
  const admin = await make(ROLE_IDS.ADMIN);
  const ticket = await ticketFor(reporter);
  const url = `/v1/notifications/ticket-settings/${ticket._id}`;

  const followed = await request(app()).put(url).set('Authorization', bearer(admin))
    .send({ following: true }).expect(200);
  assert.deepEqual(followed.body, {
    muted: false, following: true, canFollow: true, inAudienceByRole: false,
  });
  assert.deepEqual((await Ticket.findById(ticket._id)).watchers.map(String), [String(admin._id)]);

  await request(app()).put(url).set('Authorization', bearer(admin)).send({ following: false }).expect(200);
  assert.deepEqual((await Ticket.findById(ticket._id)).watchers, []);
});

test('ticket settings need a ticket you can view, and a valid body', async () => {
  const reporter = await make(ROLE_IDS.DEVELOPER);
  const stranger = await make(ROLE_IDS.DEVELOPER);
  const ticket = await ticketFor(reporter);
  const url = `/v1/notifications/ticket-settings/${ticket._id}`;

  await request(app()).get(url).expect(401);
  await request(app()).get(url).set('Authorization', bearer(stranger)).expect(403);
  await request(app()).put(url).set('Authorization', bearer(stranger)).send({ following: true }).expect(403);
  assert.deepEqual((await Ticket.findById(ticket._id)).watchers, []);
  await request(app()).put(url).set('Authorization', bearer(reporter)).send({}).expect(400);
  await request(app()).get('/v1/notifications/ticket-settings/WEB-1').set('Authorization', bearer(reporter)).expect(400);
  await request(app()).get('/v1/notifications/ticket-settings/6ab63d5aa078a6101c4c30af')
    .set('Authorization', bearer(reporter)).expect(404);
});
