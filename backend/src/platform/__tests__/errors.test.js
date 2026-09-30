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

function convert(err) {
  let converted = null;
  errorConverter(err, req, makeRes(), (e) => { converted = e; });
  return converted;
}

test('errorConverter maps a Mongo duplicate key to an operational 409', () => {
  const err = Object.assign(new Error('E11000 duplicate key error collection: pms.users index: email_1'), { code: 11000 });
  const converted = convert(err);
  assert.equal(converted.statusCode, 409);
  assert.equal(converted.code, 'CONFLICT');
  assert.equal(converted.isOperational, true);
  assert.ok(!converted.message.includes('pms.users'), 'must not leak the collection');
});

test('errorConverter maps a mongoose VersionError to 409', () => {
  const err = Object.assign(new Error('No matching document found'), { name: 'VersionError' });
  assert.equal(convert(err).statusCode, 409);
});

test('errorConverter maps a mongoose ValidationError to 400 with per-field detail', () => {
  const err = Object.assign(new Error('Ticket validation failed'), {
    name: 'ValidationError',
    errors: { title: { kind: 'required' }, priority: { kind: 'enum' } },
  });
  const converted = convert(err);
  assert.equal(converted.statusCode, 400);
  assert.equal(converted.code, 'VALIDATION_ERROR');
  assert.deepEqual(converted.fields, { title: 'title is required', priority: 'Invalid value' });
});

test('errorConverter maps a CastError to 400', () => {
  const err = Object.assign(new Error('Cast to ObjectId failed'), { name: 'CastError', path: '_id' });
  const converted = convert(err);
  assert.equal(converted.statusCode, 400);
  assert.equal(converted.message, 'Invalid _id');
});

test('errorConverter maps multer errors: file size to 413, the rest to 400', () => {
  const tooBig = Object.assign(new Error('File too large'), { name: 'MulterError', code: 'LIMIT_FILE_SIZE' });
  assert.equal(convert(tooBig).statusCode, 413);
  assert.equal(convert(tooBig).code, 'FILE_TOO_LARGE');
  const tooMany = Object.assign(new Error('Too many files'), { name: 'MulterError', code: 'LIMIT_FILE_COUNT' });
  assert.equal(convert(tooMany).statusCode, 400);
  assert.equal(convert(tooMany).code, 'UPLOAD_ERROR');
});
