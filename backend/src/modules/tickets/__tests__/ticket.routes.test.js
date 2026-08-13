import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
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

async function actorAndProject(role = 'member') {
  const user = await User.create({
    name: 'Ada', email: `${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-long-enough-password', status: 'active', role,
  });
  const project = await Project.create({ key: 'WEB', name: 'Web App', createdBy: user._id });
  return { user, project };
}

test('POST /v1/tickets creates and returns 201 with a ticketId', async () => {
  const { user, project } = await actorAndProject();

  const res = await request(app())
    .post('/v1/tickets')
    .set('Authorization', bearer(user))
    .send({ project: String(project._id), title: 'Broken login' })
    .expect(201);

  assert.equal(res.body.ticketId, 'WEB-1');
});

test('PATCH /v1/tickets/:id rejects status outright', async () => {
  const { user, project } = await actorAndProject();
  await request(app()).post('/v1/tickets').set('Authorization', bearer(user))
    .send({ project: String(project._id), title: 'Broken login' });

  const res = await request(app())
    .patch('/v1/tickets/WEB-1')
    .set('Authorization', bearer(user))
    .send({ revision: 0, status: 'live' })
    .expect(400);

  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  assert.match(res.body.error.fields.status, /transition/);
  assert.ok(res.body.requestId);
});

test('a body carrying role or createdBy is rejected, not silently dropped', async () => {
  const { user, project } = await actorAndProject('member');
  await request(app()).post('/v1/tickets').set('Authorization', bearer(user))
    .send({ project: String(project._id), title: 'Broken login' });

  const res = await request(app())
    .patch('/v1/tickets/WEB-1')
    .set('Authorization', bearer(user))
    .send({ revision: 0, priority: 'urgent', role: 'admin' })
    .expect(400);

  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  assert.equal((await User.findById(user._id)).role, 'member');
});

test('an unauthenticated request gets 401 carrying a requestId', async () => {
  const res = await request(app()).get('/v1/tickets').expect(401);

  assert.equal(res.body.error.code, 'UNAUTHENTICATED');
  assert.ok(res.body.requestId);
  assert.equal(res.headers['x-request-id'], res.body.requestId);
});

test('DELETE /v1/tickets/:id is admin-only and returns 403 for a lead', async () => {
  const { user, project } = await actorAndProject('lead');
  await request(app()).post('/v1/tickets').set('Authorization', bearer(user))
    .send({ project: String(project._id), title: 'Broken login' });

  const res = await request(app())
    .delete('/v1/tickets/WEB-1')
    .set('Authorization', bearer(user))
    .expect(403);

  assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('GET /v1/tickets/:id resolves the human ticketId', async () => {
  const { user, project } = await actorAndProject();
  await request(app()).post('/v1/tickets').set('Authorization', bearer(user))
    .send({ project: String(project._id), title: 'Broken login' });

  const res = await request(app())
    .get('/v1/tickets/WEB-1')
    .set('Authorization', bearer(user))
    .expect(200);

  assert.equal(res.body.title, 'Broken login');
});

test('POST /v1/tickets/bulk returns per-item results, not blanket success', async () => {
  const { user, project } = await actorAndProject('lead');
  await request(app()).post('/v1/tickets').set('Authorization', bearer(user))
    .send({ project: String(project._id), title: 'One' });

  const res = await request(app())
    .post('/v1/tickets/bulk')
    .set('Authorization', bearer(user))
    .send({ action: 'assign', ids: ['WEB-1', 'WEB-999'], assignedTo: String(user._id) })
    .expect(200);

  assert.equal(res.body.succeeded, 1);
  assert.equal(res.body.failed, 1);
});
