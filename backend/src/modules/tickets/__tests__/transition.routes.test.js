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
const IN_A_WEEK = new Date(Date.now() + 7 * 86400000).toISOString();

async function seed() {
  const admin = await User.create({
    name: 'Root', email: `root-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-long-enough-password', status: 'active', role: 'admin',
  });
  const project = await Project.create({ key: 'WEB', name: 'Web App', createdBy: admin._id });

  const created = await request(app()).post('/v1/tickets')
    .set('Authorization', bearer(admin))
    .send({
      project: String(project._id),
      title: 'Broken login',
      assignedTo: String(admin._id),
      estimatedResolutionAt: IN_A_WEEK,
      expectedReleaseDate: IN_A_WEEK,
    })
    .expect(201);

  return { admin, ticket: created.body };
}

test('POST /:id/transition moves the stage and returns the ticket', async () => {
  const { admin, ticket } = await seed();

  const res = await request(app())
    .post(`/v1/tickets/${ticket.ticketId}/transition`)
    .set('Authorization', bearer(admin))
    .send({ to: 'in_progress', revision: 0 })
    .expect(200);

  assert.equal(res.body.status, 'in_progress');
  assert.equal(res.body.revision, 1);
});

test('an illegal destination returns 400 with the reason, not a coerced success', async () => {
  const { ticket } = await seed();
  const member = await User.create({
    name: 'Mem', email: 'mem@example.com', password: 'a-long-enough-password',
    status: 'active', role: 'member',
  });
  await Ticket.updateOne({ _id: ticket.id }, { $set: { createdBy: member._id } });

  const res = await request(app())
    .post(`/v1/tickets/${ticket.ticketId}/transition`)
    .set('Authorization', bearer(member))
    .send({ to: 'qa_approved', revision: 0 })
    .expect(400);

  assert.equal(res.body.error.code, 'STAGE_NOT_PERMITTED');
  assert.ok(res.body.requestId);
});

test('a stale revision returns 409 carrying the current state', async () => {
  const { admin, ticket } = await seed();
  await request(app()).post(`/v1/tickets/${ticket.ticketId}/transition`)
    .set('Authorization', bearer(admin)).send({ to: 'in_progress', revision: 0 }).expect(200);

  const res = await request(app())
    .post(`/v1/tickets/${ticket.ticketId}/transition`)
    .set('Authorization', bearer(admin))
    .send({ to: 'ready_local', revision: 0 })
    .expect(409);

  assert.equal(res.body.error.code, 'STAGE_CONFLICT');
  assert.equal(res.body.error.fields.currentStatus, 'in_progress');
  assert.equal(res.body.error.fields.currentRevision, 1);
});

test('an unrelated member is refused at Layer 2 with 403, before any domain rule', async () => {
  const { ticket } = await seed();
  const stranger = await User.create({
    name: 'Mallory', email: 'mallory@example.com', password: 'a-long-enough-password',
    status: 'active', role: 'member',
  });

  const res = await request(app())
    .post(`/v1/tickets/${ticket.ticketId}/transition`)
    .set('Authorization', bearer(stranger))
    .send({ to: 'under_review', revision: 0 })
    .expect(403);

  assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('an unknown stage key is a validation error, not a domain error', async () => {
  const { admin, ticket } = await seed();

  const res = await request(app())
    .post(`/v1/tickets/${ticket.ticketId}/transition`)
    .set('Authorization', bearer(admin))
    .send({ to: 'Resolved', revision: 0 })
    .expect(400);

  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  assert.ok(res.body.error.fields.to);
});

test('the transition endpoint is the only way status changes', async () => {
  const { admin, ticket } = await seed();

  await request(app()).patch(`/v1/tickets/${ticket.ticketId}`)
    .set('Authorization', bearer(admin))
    .send({ revision: 0, status: 'live' })
    .expect(400);

  assert.equal((await Ticket.findById(ticket.id)).status, 'pending');
});
