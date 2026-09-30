import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS } from '@pms/shared';
import request from 'supertest';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import { createApp } from '../../../app.js';
import { generateAccessToken } from '../../auth/token.service.js';
import Ticket from '../../tickets/ticket.model.js';
import Project from '../../projects/project.model.js';

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

async function makeAdmin() {
  return User.create({
    name: 'Admin', email: `${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-long-enough-password', status: 'active', role: ROLE_IDS.ADMIN,
  });
}

async function makeTester() {
  return User.create({
    name: 'QA', email: `${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-long-enough-password', status: 'active', role: ROLE_IDS.TESTER,
  });
}

test('GET /v1/rbac/board-permissions returns baseline and effective policy', async () => {
  const admin = await makeAdmin();
  const res = await request(app())
    .get('/v1/rbac/board-permissions')
    .set('Authorization', bearer(admin))
    .expect(200);

  assert.ok(res.body.baseline);
  assert.ok(res.body.effective);
  assert.ok(res.body.effective[ROLE_IDS.TESTER]?.qa?.includes('qa_approve'));
});

test('PUT /v1/rbac/board-permissions persists custom grants', async () => {
  const admin = await makeAdmin();
  const baseline = await request(app())
    .get('/v1/rbac/board-permissions')
    .set('Authorization', bearer(admin))
    .expect(200);

  const grants = { ...baseline.body.effective };
  grants[ROLE_IDS.SUPPORT] = {
    ...grants[ROLE_IDS.SUPPORT],
    intake: ['operate'],
  };

  const updated = await request(app())
    .put('/v1/rbac/board-permissions')
    .set('Authorization', bearer(admin))
    .send({ grants })
    .expect(200);

  assert.ok(updated.body.effective[ROLE_IDS.SUPPORT].intake.includes('operate'));
});

test('GET /v1/rbac/board-permissions/effective is available to any authenticated user', async () => {
  const tester = await makeTester();
  const res = await request(app())
    .get('/v1/rbac/board-permissions/effective')
    .set('Authorization', bearer(tester))
    .expect(200);

  assert.ok(res.body.effective[ROLE_IDS.TESTER].qa.includes('qa_approve'));
});

test('transition enforces persisted board policy — tester without qa_approve cannot approve', async () => {
  const admin = await makeAdmin();
  const tester = await makeTester();
  const project = await Project.create({ key: 'WEB', name: 'Web', createdBy: admin._id });

  await request(app())
    .put('/v1/rbac/board-permissions')
    .set('Authorization', bearer(admin))
    .send({
      grants: {
        [ROLE_IDS.TESTER]: { qa: ['operate'] },
      },
    })
    .expect(200);

  const ticket = await Ticket.create({
    ticketId: 'WEB-1',
    project: project._id,
    title: 'QA gate test',
    createdBy: admin._id,
    testedBy: tester._id,
    severity: 'Minor',
    priority: 'Low',
    status: 'deployed_staging',
    estimatedResolutionAt: new Date(Date.now() + 86400000),
    expectedReleaseDate: new Date(Date.now() + 86400000),
  });

  const res = await request(app())
    .post(`/v1/tickets/${ticket._id}/transition`)
    .set('Authorization', bearer(tester))
    .send({ to: 'qa_approved', revision: 0 })
    .expect(400);

  assert.equal(res.body.error.code, 'STAGE_NOT_PERMITTED');
});
