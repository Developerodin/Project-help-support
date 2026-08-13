import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, errorConverter, errorHandler } from '../errors.js';

/** Minimal express-shaped res double: records status and body. */
function makeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

const req = { id: 'req-123' };
const devConfig = { isProduction: false };
const prodConfig = { isProduction: true };

test('ApiError carries status, code, message and optional fields', () => {
  const err = new ApiError(400, 'VALIDATION_ERROR', 'Validation failed', { title: 'required' });
  assert.equal(err.statusCode, 400);
  assert.equal(err.code, 'VALIDATION_ERROR');
  assert.equal(err.message, 'Validation failed');
  assert.deepEqual(err.fields, { title: 'required' });
  assert.equal(err.isOperational, true);
});

test('errorConverter wraps an unrecognised error as a non-operational 500', () => {
  let converted = null;
  errorConverter(new TypeError('boom'), req, makeRes(), (e) => { converted = e; });
  assert.ok(converted instanceof ApiError);
  assert.equal(converted.statusCode, 500);
  assert.equal(converted.code, 'INTERNAL_ERROR');
  assert.equal(converted.isOperational, false);
});

test('errorConverter passes an ApiError through untouched', () => {
  const original = new ApiError(404, 'NOT_FOUND', 'Ticket not found');
  let converted = null;
  errorConverter(original, req, makeRes(), (e) => { converted = e; });
  assert.equal(converted, original);
});

test('errorHandler emits the canonical response shape with the requestId', () => {
  const res = makeRes();
  errorHandler(devConfig)(
    new ApiError(400, 'VALIDATION_ERROR', 'Validation failed', { title: 'Title is required' }),
    req, res, () => {},
  );
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, {
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      fields: { title: 'Title is required' },
    },
    requestId: 'req-123',
  });
});

test('errorHandler omits fields when there are none', () => {
  const res = makeRes();
  errorHandler(devConfig)(new ApiError(404, 'NOT_FOUND', 'Ticket not found'), req, res, () => {});
  assert.deepEqual(res.body, {
    error: { code: 'NOT_FOUND', message: 'Ticket not found' },
    requestId: 'req-123',
  });
});

test('production hides the message of a non-operational error but keeps the requestId', () => {
  const res = makeRes();
  const err = new ApiError(500, 'INTERNAL_ERROR', 'connect ECONNREFUSED 10.0.0.4:27017');
  err.isOperational = false;
  errorHandler(prodConfig)(err, req, res, () => {});
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error.message, 'Internal server error');
  assert.ok(!res.body.error.message.includes('10.0.0.4'), 'must not leak internals');
  assert.equal(res.body.requestId, 'req-123');
});

test('production still shows operational error messages', () => {
  const res = makeRes();
  errorHandler(prodConfig)(new ApiError(403, 'FORBIDDEN', 'Admin role required'), req, res, () => {});
  assert.equal(res.body.error.message, 'Admin role required');
});
