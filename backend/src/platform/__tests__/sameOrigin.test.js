import test from 'node:test';
import assert from 'node:assert/strict';
import { sameOrigin } from '../sameOrigin.js';

const config = { corsOrigins: ['https://pms.example.com'] };

function run(req) {
  return new Promise((resolve) => sameOrigin(config)(req, {}, (err) => resolve(err)));
}

test('allows a request with no Origin or Referer (curl, server-to-server)', async () => {
  assert.equal(await run({ method: 'POST', headers: {} }), undefined);
});

test('allows an allowlisted Origin', async () => {
  assert.equal(await run({ method: 'POST', headers: { origin: 'https://pms.example.com' } }), undefined);
});

test('rejects a foreign Origin on a state-changing request', async () => {
  const err = await run({ method: 'POST', headers: { origin: 'https://evil.example.com' } });
  assert.equal(err.statusCode, 403);
  assert.equal(err.code, 'CROSS_ORIGIN_BLOCKED');
});

test('allows a foreign Origin on a safe method', async () => {
  assert.equal(await run({ method: 'GET', headers: { origin: 'https://evil.example.com' } }), undefined);
});

test('falls back to Referer when Origin is absent', async () => {
  const ok = await run({ method: 'POST', headers: { referer: 'https://pms.example.com/tickets' } });
  assert.equal(ok, undefined);

  const bad = await run({ method: 'POST', headers: { referer: 'https://evil.example.com/x' } });
  assert.equal(bad.statusCode, 403);
});

test('a malformed Referer is rejected rather than parsed optimistically', async () => {
  const err = await run({ method: 'POST', headers: { referer: 'not-a-url' } });
  assert.equal(err.statusCode, 403);
});
