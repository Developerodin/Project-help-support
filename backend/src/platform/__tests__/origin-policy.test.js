import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOriginMatcher } from '../origin-policy.js';

function config(overrides = {}) {
  return {
    nodeEnv: 'development',
    frontendBaseUrl: 'http://localhost:3002',
    corsOrigins: ['http://localhost:3002'],
    ...overrides,
  };
}

test('allows exact configured origins', () => {
  const isAllowed = buildOriginMatcher(config());
  assert.equal(isAllowed('http://localhost:3002'), true);
});

test('allows private-lan origins in development on frontend port', () => {
  const isAllowed = buildOriginMatcher(config());
  assert.equal(isAllowed('http://192.168.0.10:3002'), true);
  assert.equal(isAllowed('http://10.20.30.40:3002'), true);
});

test('rejects private-lan origins with a different port', () => {
  const isAllowed = buildOriginMatcher(config());
  assert.equal(isAllowed('http://192.168.0.10:3000'), false);
});

test('rejects public internet hosts even in development', () => {
  const isAllowed = buildOriginMatcher(config());
  assert.equal(isAllowed('http://example.com:3002'), false);
});

test('rejects non-configured lan origins in production', () => {
  const isAllowed = buildOriginMatcher(config({ nodeEnv: 'production' }));
  assert.equal(isAllowed('http://192.168.0.10:3002'), false);
});

test('allows requests without Origin header', () => {
  const isAllowed = buildOriginMatcher(config());
  assert.equal(isAllowed(undefined), true);
});

