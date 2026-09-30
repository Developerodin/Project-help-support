import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS } from '@pms/shared';
import request from 'supertest';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
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

async function createUser({ email, roles }) {
  return User.create({
    name: email.split('@')[0],
    email,
    password: 'a-long-enough-password',
    status: 'active',
    role: roles[0],
    roles,
  });
}

test('read_only user with VIEW can comment but not without VIEW', async () => {
  const readOnly = await createUser({
    email: `readonly-${Math.random().toString(36).slice(2)}@example.com`,
    roles: [ROLE_IDS.READ_ONLY],
  });

  const fakeTicketId = '507f1f77bcf86cd799439011';

  const watch = await request(app())
    .post(`/v1/tickets/${fakeTicketId}/watch`)
    .set('Authorization', bearer(readOnly))
    .expect(404);
  assert.equal(watch.body.error.code, 'TICKET_NOT_FOUND');

  const comment = await request(app())
    .post(`/v1/tickets/${fakeTicketId}/comments`)
    .set('Authorization', bearer(readOnly))
    .send({ content: 'test' })
    .expect(404);
  assert.equal(comment.body.error.code, 'TICKET_NOT_FOUND');
});

test('unassigned user without VIEW is rejected at comment gate', async () => {
  const outsider = await createUser({
    email: `none-${Math.random().toString(36).slice(2)}@example.com`,
    roles: [ROLE_IDS.UNASSIGNED],
  });

  const fakeTicketId = '507f1f77bcf86cd799439011';

  const comment = await request(app())
    .post(`/v1/tickets/${fakeTicketId}/comments`)
    .set('Authorization', bearer(outsider))
    .send({ content: 'test' })
    .expect(403);
  assert.equal(comment.body.error.code, 'FORBIDDEN');
});

test('developer user passes ticket comment gate', async () => {
  const developer = await createUser({
    email: `dev-${Math.random().toString(36).slice(2)}@example.com`,
    roles: [ROLE_IDS.DEVELOPER],
  });

  const fakeTicketId = '507f1f77bcf86cd799439011';

  const response = await request(app())
    .post(`/v1/tickets/${fakeTicketId}/comments`)
    .set('Authorization', bearer(developer))
    .send({ body: 'test' });

  assert.notEqual(response.status, 403, 'developer should not be blocked at route layer');
});
