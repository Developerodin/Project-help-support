import test from 'node:test';
import assert from 'node:assert/strict';
import { requestId } from '../requestId.js';

function makeCtx(headers = {}) {
  const req = { headers };
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; } };
  return { req, res };
}

test('generates a request id and sets the response header', () => {
  const { req, res } = makeCtx();
  let called = false;
  requestId(req, res, () => { called = true; });
  assert.ok(called);
  assert.match(req.id, /^[0-9a-f-]{36}$/);
  assert.equal(res.headers['X-Request-Id'], req.id);
});

test('honours an inbound X-Request-Id so a trace survives a proxy hop', () => {
  const { req, res } = makeCtx({ 'x-request-id': 'upstream-abc-123' });
  requestId(req, res, () => {});
  assert.equal(req.id, 'upstream-abc-123');
  assert.equal(res.headers['X-Request-Id'], 'upstream-abc-123');
});

test('rejects an absurdly long inbound id rather than echoing it', () => {
  const { req, res } = makeCtx({ 'x-request-id': 'x'.repeat(500) });
  requestId(req, res, () => {});
  assert.notEqual(req.id, 'x'.repeat(500));
  assert.match(req.id, /^[0-9a-f-]{36}$/);
});
