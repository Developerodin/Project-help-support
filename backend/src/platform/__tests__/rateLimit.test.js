import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { makeLimiter, loginLimiter, loginIpLimiter } from '../rateLimit.js';
import { withMemoryDb } from './helpers/memoryDb.js';

withMemoryDb();

function appWith(limiter) {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.post('/try', limiter, (_req, res) => res.status(200).json({ ok: true }));
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({
    error: { code: err.code, message: err.message },
  }));
  return app;
}

test('allows requests up to the limit then returns 429', async () => {
  const app = appWith(makeLimiter({ windowMs: 60000, limit: 3 }));
  for (let i = 0; i < 3; i += 1) {
    await request(app).post('/try').expect(200);
  }
  const res = await request(app).post('/try').expect(429);
  assert.equal(res.body.error.code, 'RATE_LIMITED');
});

test('sets Retry-After on a limited response', async () => {
  const app = appWith(makeLimiter({ windowMs: 60000, limit: 1 }));
  await request(app).post('/try').expect(200);
  const res = await request(app).post('/try').expect(429);
  assert.ok(res.headers['retry-after'], 'Retry-After header must be present');
});

test('keys by IP and email together, so one account cannot be sprayed from many IPs', async () => {
  const app = appWith(makeLimiter({ windowMs: 60000, limit: 2, byEmail: true }));

  await request(app).post('/try').set('X-Forwarded-For', '1.1.1.1').send({ email: 'a@x.com' }).expect(200);
  await request(app).post('/try').set('X-Forwarded-For', '2.2.2.2').send({ email: 'a@x.com' }).expect(200);
  await request(app).post('/try').set('X-Forwarded-For', '3.3.3.3').send({ email: 'a@x.com' }).expect(429);

  // A different email is a different bucket and is unaffected.
  await request(app).post('/try').set('X-Forwarded-For', '3.3.3.3').send({ email: 'b@x.com' }).expect(200);
});

test('email keying is case and whitespace insensitive', async () => {
  const app = appWith(makeLimiter({ windowMs: 60000, limit: 1, byEmail: true }));
  await request(app).post('/try').send({ email: 'a@x.com' }).expect(200);
  await request(app).post('/try').send({ email: '  A@X.COM ' }).expect(429);
});

test('login is also capped per IP, across many emails, in the shared Mongo store', async () => {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.post('/login', loginIpLimiter, loginLimiter, (_req, res) => res.status(200).json({ ok: true }));
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ error: { code: err.code } }));

  for (let i = 0; i < 50; i += 1) {
    await request(app).post('/login').set('X-Forwarded-For', '9.9.9.9').send({ email: `u${i}@x.com` }).expect(200);
  }
  const res = await request(app).post('/login').set('X-Forwarded-For', '9.9.9.9').send({ email: 'fresh@x.com' })
    .expect(429);
  assert.equal(res.body.error.code, 'RATE_LIMITED');
  // Another IP has its own bucket.
  await request(app).post('/login').set('X-Forwarded-For', '8.8.8.8').send({ email: 'fresh@x.com' }).expect(200);
});

test('refresh counts only failed attempts, so a busy session is never locked out', async () => {
  const { MongoRateLimitStore } = await import('../rateLimit.js');
  const limiter = makeLimiter({
    windowMs: 60000, limit: 2, store: new MongoRateLimitStore('t-refresh'), skipSuccessfulRequests: true,
  });
  const app = express();
  app.post('/ok', limiter, (_req, res) => res.status(200).json({ ok: true }));
  app.post('/bad', limiter, (_req, res) => res.status(401).json({}));
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({}));

  for (let i = 0; i < 5; i += 1) await request(app).post('/ok').expect(200);
  await request(app).post('/bad').expect(401);
  await request(app).post('/bad').expect(401);
  await request(app).post('/bad').expect(429);
});
