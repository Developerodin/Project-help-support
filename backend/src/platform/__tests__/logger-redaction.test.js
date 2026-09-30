import test from 'node:test';
import assert from 'node:assert/strict';
import { redactSensitiveQuery } from '../logger.js';

test('an access token in a request URL never reaches a log line', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2lnbmF0dXJl';

  assert.equal(
    redactSensitiveQuery(`/v1/realtime/stream?access_token=${jwt}`),
    '/v1/realtime/stream?access_token=REDACTED',
  );
  // Still redacted when it is not the first param, and the rest survives.
  assert.equal(
    redactSensitiveQuery(`/v1/realtime/stream?project=abc123&access_token=${jwt}`),
    '/v1/realtime/stream?project=abc123&access_token=REDACTED',
  );
  // A param after it must not be swallowed by the replacement.
  assert.equal(
    redactSensitiveQuery(`/v1/realtime/stream?access_token=${jwt}&project=abc123`),
    '/v1/realtime/stream?access_token=REDACTED&project=abc123',
  );
});

test('URLs without a token pass through untouched', () => {
  for (const url of ['/v1/tickets?page=2', '/health', '', undefined]) {
    assert.equal(redactSensitiveQuery(url), url);
  }
});
