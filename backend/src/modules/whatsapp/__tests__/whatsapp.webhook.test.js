import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import request from 'supertest';
import { loadConfig } from '../../../platform/config.js';
import { createApp } from '../../../app.js';
import { redactSensitiveQuery } from '../../../platform/logger.js';
import { testEnv } from '../../../test/test-env.js';

const app = createApp(loadConfig({
  ...testEnv,
  WHATSAPP_VERIFY_TOKEN: 'verify-me',
  WHATSAPP_APP_SECRET: 'app-secret',
  WHATSAPP_TOKEN: 'token',
  WHATSAPP_PHONE_NUMBER_ID: '123',
}));
const sign = (body) => `sha256=${crypto.createHmac('sha256', 'app-secret').update(body).digest('hex')}`;
// A delivery status, not a message: this file checks the signature, not the answering (whatsapp.chat.test.js).
const body = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.1', status: 'read' }] } }] }] });

test('handshake echoes the challenge only for the right verify token', async () => {
  const res = await request(app).get('/v1/whatsapp/webhook')
    .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': '1158201444' })
    .expect(200);
  assert.equal(res.text, '1158201444');
  await request(app).get('/v1/whatsapp/webhook')
    .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'x' })
    .expect(403);
});

test('POST accepts Meta-signed bodies and rejects unsigned or tampered ones', async () => {
  const post = () => request(app).post('/v1/whatsapp/webhook').set('Content-Type', 'application/json');
  await post().set('X-Hub-Signature-256', sign(body)).send(body).expect(200);
  await post().send(body).expect(401);
  await post().set('X-Hub-Signature-256', sign(body)).send(body.replace('read', 'sent')).expect(401);
});

test('route is absent without WhatsApp config', async () => {
  await request(createApp(loadConfig(testEnv))).get('/v1/whatsapp/webhook').expect(404);
});

test('access log redacts the verify token', () => {
  assert.equal(
    redactSensitiveQuery('/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=s3cret&hub.challenge=1'),
    '/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=REDACTED&hub.challenge=1',
  );
});
