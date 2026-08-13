import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import Ticket from '../ticket.model.js';
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
const bearer = (user) => `Bearer ${generateAccessToken(user, config)}`;

async function seed(role = 'member') {
  const user = await User.create({
    name: role, email: `${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-long-enough-password', status: 'active', role,
  });
  const project = await Project.create({ key: 'WEB', name: 'Web App', createdBy: user._id });
  await Ticket.create({
    ticketId: 'WEB-1', project: project._id, title: 'x', createdBy: user._id, status: 'pending',
  });
  return { user, project };
}

test('analytics is reachable by a member — it is NOT admin-only', async () => {
  const { user } = await seed('member');

  const res = await request(app())
    .get('/v1/analytics/overview')
    .set('Authorization', bearer(user))
    .expect(200);

  assert.equal(res.body.total, 1);
  assert.equal(res.body.lanes.intake, 1);
});

test('the tiles sum to the total for the selected filters', async () => {
  const { user, project } = await seed('member');

  const res = await request(app())
    .get(`/v1/analytics/overview?project=${project._id}`)
    .set('Authorization', bearer(user))
    .expect(200);

  assert.equal(Object.values(res.body.lanes).reduce((a, b) => a + b, 0), res.body.total);
});

test('unauthenticated analytics is 401 with a requestId', async () => {
  const res = await request(app()).get('/v1/analytics/overview').expect(401);

  assert.equal(res.body.error.code, 'UNAUTHENTICATED');
  assert.ok(res.body.requestId);
});

test('trend, time-in-stage and drill all answer', async () => {
  const { user } = await seed();

  const trend = await request(app()).get('/v1/analytics/trend?groupBy=week')
    .set('Authorization', bearer(user)).expect(200);
  assert.equal(trend.body.groupBy, 'week');

  const stages = await request(app()).get('/v1/analytics/time-in-stage')
    .set('Authorization', bearer(user)).expect(200);
  assert.ok(stages.body.byStage.pending);

  const drill = await request(app()).get('/v1/analytics/drill?dimension=module')
    .set('Authorization', bearer(user)).expect(200);
  assert.equal(drill.body.dimension, 'module');
});

test('an unknown drill dimension is a validation error, not a silent default', async () => {
  const { user } = await seed();

  const res = await request(app()).get('/v1/analytics/drill?dimension=favourite_colour')
    .set('Authorization', bearer(user)).expect(400);

  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});
