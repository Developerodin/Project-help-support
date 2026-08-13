import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import mongoose from 'mongoose';
import { withMemoryDb, getMemoryUri } from '../platform/__tests__/helpers/memoryDb.js';
import User from '../modules/users/user.model.js';
import { createApp } from '../app.js';

withMemoryDb();

const config = {
  nodeEnv: 'test',
  isProduction: false,
  port: 4000,
  mongoUrl: 'mongodb://unused',
  frontendBaseUrl: 'http://localhost:3000',
  corsOrigins: ['http://localhost:3000'],
  jwt: {
    secret: 'a-sufficiently-long-test-secret-value-here',
    accessExpirationMinutes: 15,
    refreshExpirationDays: 30,
  },
  cookie: { domain: undefined, secure: false },
  features: { attachments: false, email: false, seed: false },
  storage: null,
  email: null,
  seed: null,
};

const app = () => createApp(config);

const activeUser = () => User.create({
  name: 'Ada', email: 'ada@example.com', password: 'correct-horse-battery', status: 'active',
});

test('GET /health reports liveness', async () => {
  const res = await request(app()).get('/health').expect(200);
  assert.equal(res.body.status, 'ok');
});

test('GET /ready reports database connectivity', async () => {
  const res = await request(app()).get('/ready').expect(200);
  assert.equal(res.body.status, 'ready');
  assert.equal(res.body.checks.database, true);
});

test('GET /ready returns 503 when the database is down, and /health still 200', async () => {
  await mongoose.disconnect();

  const ready = await request(app()).get('/ready').expect(503);
  assert.equal(ready.body.checks.database, false);

  await request(app()).get('/health').expect(200);

  await mongoose.connect(getMemoryUri());
});

test('every response carries an X-Request-Id header', async () => {
  const res = await request(app()).get('/health').expect(200);
  assert.match(res.headers['x-request-id'], /^[0-9a-f-]{36}$/);
});

test('a 404 uses the canonical error shape and carries a requestId', async () => {
  const res = await request(app()).get('/v1/nope').expect(404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
  assert.ok(res.body.requestId, 'requestId must be present on a 404');
});

test('a 401 carries a requestId — proving requestId runs before auth', async () => {
  const res = await request(app()).get('/v1/auth/me').expect(401);
  assert.equal(res.body.error.code, 'UNAUTHENTICATED');
  assert.ok(res.body.requestId, 'requestId must be present on a 401');
});

test('a 400 validation failure returns mapped fields', async () => {
  const res = await request(app()).post('/v1/auth/login').send({ email: 'not-an-email' }).expect(400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  assert.ok(res.body.error.fields.email);
  assert.ok(res.body.error.fields.password);
});

test('/v1 responses are marked no-store', async () => {
  const res = await request(app()).get('/v1/auth/me');
  assert.match(res.headers['cache-control'], /no-store/);
});

test('login sets an httpOnly, SameSite=Strict refresh cookie scoped to /v1/auth', async () => {
  await activeUser();
  const res = await request(app())
    .post('/v1/auth/login')
    .send({ email: 'ada@example.com', password: 'correct-horse-battery' })
    .expect(200);

  assert.ok(res.body.accessToken);
  const cookie = res.headers['set-cookie'].find((c) => c.startsWith('pms_refresh='));
  assert.ok(cookie, 'refresh cookie must be set');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.match(cookie, /Path=\/v1\/auth/i);
});

test('the login response body never contains the password or refresh token', async () => {
  await activeUser();
  const res = await request(app())
    .post('/v1/auth/login')
    .send({ email: 'ada@example.com', password: 'correct-horse-battery' })
    .expect(200);

  const serialised = JSON.stringify(res.body);
  assert.ok(!serialised.includes('correct-horse-battery'));
  assert.equal(res.body.user.password, undefined);
  assert.equal(res.body.refreshToken, undefined);
});

test('refresh from a foreign Origin is blocked', async () => {
  await activeUser();
  const server = app();

  const login = await request(server)
    .post('/v1/auth/login')
    .send({ email: 'ada@example.com', password: 'correct-horse-battery' })
    .expect(200);

  const res = await request(server)
    .post('/v1/auth/refresh')
    .set('Cookie', login.headers['set-cookie'])
    .set('Origin', 'https://evil.example.com')
    .expect(403);

  assert.equal(res.body.error.code, 'CROSS_ORIGIN_BLOCKED');
});

test('a full login → me → logout → refresh-fails cycle works', async () => {
  await activeUser();
  const server = app();

  const login = await request(server)
    .post('/v1/auth/login')
    .send({ email: 'ada@example.com', password: 'correct-horse-battery' })
    .expect(200);

  const me = await request(server)
    .get('/v1/auth/me')
    .set('Authorization', `Bearer ${login.body.accessToken}`)
    .expect(200);
  assert.equal(me.body.user.email, 'ada@example.com');

  await request(server)
    .post('/v1/auth/logout')
    .set('Cookie', login.headers['set-cookie'])
    .set('Origin', 'http://localhost:3000')
    .expect(204);

  await request(server)
    .post('/v1/auth/refresh')
    .set('Cookie', login.headers['set-cookie'])
    .set('Origin', 'http://localhost:3000')
    .expect(401);
});
