import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import { createApp } from '../../../app.js';
import Ticket from '../ticket.model.js';
import mongoose from 'mongoose';
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

const createBody = (projectId, title = 'Broken login button') => ({
  project: String(projectId),
  title,
  description: 'Expected login to succeed but the button does nothing when clicked.',
});

test('POST /v1/tickets creates and returns 201 with a ticketId', async () => {
  const { user, project } = await actorAndProject();

  const res = await request(app())
    .post('/v1/tickets')
    .set('Authorization', bearer(user))
    .send(createBody(project._id))
    .expect(201);

  assert.equal(res.body.ticketId, 'WEB-1');
});

test('PATCH /v1/tickets/:id rejects status outright', async () => {
  const { user, project } = await actorAndProject();
  await request(app()).post('/v1/tickets').set('Authorization', bearer(user))
    .send(createBody(project._id));

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
    .send(createBody(project._id));

  const res = await request(app())
    .patch('/v1/tickets/WEB-1')
    .set('Authorization', bearer(user))
    .send({ revision: 0, priority: 'Urgent', role: 'admin' })
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
    .send(createBody(project._id));

  const res = await request(app())
    .delete('/v1/tickets/WEB-1')
    .set('Authorization', bearer(user))
    .expect(403);

  assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('GET /v1/tickets/:id resolves the human ticketId', async () => {
  const { user, project } = await actorAndProject();
  await request(app()).post('/v1/tickets').set('Authorization', bearer(user))
    .send(createBody(project._id));

  const res = await request(app())
    .get('/v1/tickets/WEB-1')
    .set('Authorization', bearer(user))
    .expect(200);

  assert.equal(res.body.title, 'Broken login button');
});

test('POST /v1/tickets/bulk returns per-item results, not blanket success', async () => {
  const { user, project } = await actorAndProject('lead');
  await request(app()).post('/v1/tickets').set('Authorization', bearer(user))
    .send(createBody(project._id, 'Ticket one for bulk assign'));

  const res = await request(app())
    .post('/v1/tickets/bulk')
    .set('Authorization', bearer(user))
    .send({ action: 'assign', ids: ['WEB-1', 'WEB-999'], assignedTo: String(user._id) })
    .expect(200);

  assert.equal(res.body.succeeded, 1);
  assert.equal(res.body.failed, 1);
});

test('POST /v1/tickets/:id/comments creates a comment', async () => {
  const { user, project } = await actorAndProject();
  await request(app()).post('/v1/tickets').set('Authorization', bearer(user))
    .send(createBody(project._id));

  const res = await request(app())
    .post('/v1/tickets/WEB-1/comments')
    .set('Authorization', bearer(user))
    .send({ content: 'Reproduced on Safari', clientRef: 'client-ref-1' })
    .expect(201);

  assert.equal(res.body.content, 'Reproduced on Safari');
  assert.ok(res.body.id || res.body._id);
});

test('POST /v1/tickets/:id/comments rejects empty content', async () => {
  const { user, project } = await actorAndProject();
  await request(app()).post('/v1/tickets').set('Authorization', bearer(user))
    .send(createBody(project._id));

  const res = await request(app())
    .post('/v1/tickets/WEB-1/comments')
    .set('Authorization', bearer(user))
    .send({ content: '   ', clientRef: 'client-ref-2' })
    .expect(400);

  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  assert.ok(res.body.requestId);
});

test('an unauthenticated GET /v1/tickets/:id gets 401 carrying a requestId', async () => {
  const { user, project } = await actorAndProject();
  await request(app()).post('/v1/tickets').set('Authorization', bearer(user))
    .send(createBody(project._id));

  const res = await request(app()).get('/v1/tickets/WEB-1').expect(401);

  assert.equal(res.body.error.code, 'UNAUTHENTICATED');
  assert.ok(res.body.requestId);
});

test('GET /v1/tickets/:id returns 403 for a member with no relationship to the ticket', async () => {
  const { user, project } = await actorAndProject();
  await request(app()).post('/v1/tickets').set('Authorization', bearer(user))
    .send(createBody(project._id));

  const stranger = await User.create({
    name: 'Bob', email: `${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-long-enough-password', status: 'active', role: 'member',
  });

  const res = await request(app())
    .get('/v1/tickets/WEB-1')
    .set('Authorization', bearer(stranger))
    .expect(403);

  assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('GET /v1/tickets/:id/attachments/:attachmentId/download returns a presigned URL as JSON', async () => {
  const enabledConfig = {
    ...config,
    features: { attachments: true, email: false, seed: false },
    storage: {
      region: 'us-east-1',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      bucket: 'test-bucket',
    },
  };
  const enabledApp = () => createApp(enabledConfig);

  const { user, project } = await actorAndProject();
  await request(enabledApp()).post('/v1/tickets').set('Authorization', bearer(user))
    .send(createBody(project._id));

  const attachmentId = new mongoose.Types.ObjectId();
  await Ticket.updateOne(
    { ticketId: 'WEB-1' },
    {
      $push: {
        attachments: {
          _id: attachmentId,
          key: `tickets/${user._id}/test.png`,
          name: 'shot.png',
          size: 128,
          mimeType: 'image/png',
          uploadedBy: user._id,
          uploadedAt: new Date(),
        },
      },
    },
  );

  const res = await request(enabledApp())
    .get(`/v1/tickets/WEB-1/attachments/${attachmentId}/download`)
    .set('Authorization', bearer(user))
    .set('Accept', 'application/json')
    .expect(200);

  assert.match(res.body.url, /^https:\/\/test-bucket\.s3\.us-east-1\.amazonaws\.com\//);
});

test('GET /v1/tickets/:id/attachments/:attachmentId/download returns 403 for an unrelated member', async () => {
  const enabledConfig = {
    ...config,
    features: { attachments: true, email: false, seed: false },
    storage: {
      region: 'us-east-1',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      bucket: 'test-bucket',
    },
  };
  const enabledApp = () => createApp(enabledConfig);

  const { user, project } = await actorAndProject();
  await request(enabledApp()).post('/v1/tickets').set('Authorization', bearer(user))
    .send(createBody(project._id));

  const attachmentId = new mongoose.Types.ObjectId();
  await Ticket.updateOne(
    { ticketId: 'WEB-1' },
    {
      $push: {
        attachments: {
          _id: attachmentId,
          key: `tickets/${user._id}/test.png`,
          name: 'shot.png',
          size: 128,
          mimeType: 'image/png',
          uploadedBy: user._id,
          uploadedAt: new Date(),
        },
      },
    },
  );

  const stranger = await User.create({
    name: 'Eve', email: `${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-long-enough-password', status: 'active', role: 'member',
  });

  const res = await request(enabledApp())
    .get(`/v1/tickets/WEB-1/attachments/${attachmentId}/download`)
    .set('Authorization', bearer(stranger))
    .set('Accept', 'application/json')
    .expect(403);

  assert.equal(res.body.error.code, 'FORBIDDEN');
});
