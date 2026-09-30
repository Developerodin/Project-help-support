import assert from 'node:assert/strict';
import test from 'node:test';
import { assertNodeEnvSet, loadConfig } from '../config.js';

const BASE_ENV = {
  MONGODB_URL: 'mongodb://localhost:27017/pms',
  JWT_SECRET: 'a'.repeat(32),
  FRONTEND_BASE_URL: 'http://localhost:3002',
  CORS_ORIGINS: 'http://localhost:3002',
};
const EMAIL_ENV = {
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  SMTP_USERNAME: 'mailbox@example.com',
  SMTP_PASSWORD: 'secret',
  EMAIL_FROM: 'PMS <mailbox@example.com>',
};

test('refresh cookie defaults to SameSite=none with secure true for embed mode', () => {
  const config = loadConfig({ ...BASE_ENV, NODE_ENV: 'development' });
  assert.equal(config.cookie.sameSite, 'none');
  assert.equal(config.cookie.secure, true);
});

test('refresh cookie accepts SameSite=strict opt-in in development', () => {
  const config = loadConfig({
    ...BASE_ENV,
    NODE_ENV: 'development',
    REFRESH_COOKIE_SAMESITE: 'strict',
  });
  assert.equal(config.cookie.sameSite, 'strict');
  assert.equal(config.cookie.secure, false);
});

test('refresh cookie accepts SameSite=none when secure is true', () => {
  const config = loadConfig({
    ...BASE_ENV,
    NODE_ENV: 'development',
    REFRESH_COOKIE_SAMESITE: 'none',
    REFRESH_COOKIE_SECURE: 'true',
  });
  assert.equal(config.cookie.sameSite, 'none');
  assert.equal(config.cookie.secure, true);
});

test('refresh cookie rejects SameSite=none without secure flag', () => {
  assert.throws(
    () => loadConfig({
      ...BASE_ENV,
      NODE_ENV: 'development',
      REFRESH_COOKIE_SAMESITE: 'none',
      REFRESH_COOKIE_SECURE: 'false',
    }),
    /REFRESH_COOKIE_SAMESITE=none requires REFRESH_COOKIE_SECURE=true/,
  );
});

test('refresh cookie secure defaults to true in production', () => {
  const config = loadConfig({ ...BASE_ENV, NODE_ENV: 'production' });
  assert.equal(config.cookie.secure, true);
  assert.equal(config.cookie.sameSite, 'none');
});

test('ticket notification test sink is disabled by default', () => {
  const config = loadConfig({ ...BASE_ENV, ...EMAIL_ENV, NODE_ENV: 'development' });
  assert.equal(config.email.testSinkEnabled, false);
  assert.equal(config.email.testSinkTo, '');
});

test('ticket notification sink requires destination when enabled', () => {
  assert.throws(
    () => loadConfig({
      ...BASE_ENV,
      ...EMAIL_ENV,
      NODE_ENV: 'development',
      TICKET_NOTIFICATION_TEST_EMAIL_ENABLED: 'true',
    }),
    /TICKET_NOTIFICATION_TEST_EMAIL must be set/,
  );
});

test('ticket notification sink can be enabled in non-production', () => {
  const config = loadConfig({
    ...BASE_ENV,
    ...EMAIL_ENV,
    NODE_ENV: 'development',
    TICKET_NOTIFICATION_TEST_EMAIL_ENABLED: 'true',
    TICKET_NOTIFICATION_TEST_EMAIL: 'ops@example.com',
  });

  assert.equal(config.email.testSinkEnabled, true);
  assert.equal(config.email.testSinkTo, 'ops@example.com');
});

test('ticket notification sink in production requires explicit override', () => {
  assert.throws(
    () => loadConfig({
      ...BASE_ENV,
      ...EMAIL_ENV,
      NODE_ENV: 'production',
      TICKET_NOTIFICATION_TEST_EMAIL_ENABLED: 'true',
      TICKET_NOTIFICATION_TEST_EMAIL: 'ops@example.com',
    }),
    /disabled in production unless TICKET_NOTIFICATION_TEST_EMAIL_ALLOW_PRODUCTION=true/,
  );
});

test('ticket notification sink in production requires allowlist membership', () => {
  assert.throws(
    () => loadConfig({
      ...BASE_ENV,
      ...EMAIL_ENV,
      NODE_ENV: 'production',
      TICKET_NOTIFICATION_TEST_EMAIL_ENABLED: 'true',
      TICKET_NOTIFICATION_TEST_EMAIL_ALLOW_PRODUCTION: 'true',
      TICKET_NOTIFICATION_TEST_EMAIL: 'ops@example.com',
      TICKET_NOTIFICATION_TEST_EMAIL_PRODUCTION_ALLOWLIST: 'alerts@example.com',
    }),
    /requires TICKET_NOTIFICATION_TEST_EMAIL to be present/,
  );
});

test('ticket notification sink in production accepts approved allowlist address', () => {
  const config = loadConfig({
    ...BASE_ENV,
    ...EMAIL_ENV,
    NODE_ENV: 'production',
    TICKET_NOTIFICATION_TEST_EMAIL_ENABLED: 'true',
    TICKET_NOTIFICATION_TEST_EMAIL_ALLOW_PRODUCTION: 'true',
    TICKET_NOTIFICATION_TEST_EMAIL: 'ops@example.com',
    TICKET_NOTIFICATION_TEST_EMAIL_PRODUCTION_ALLOWLIST: 'alerts@example.com,ops@example.com',
  });

  assert.equal(config.email.testSinkEnabled, true);
  assert.equal(config.email.testSinkTo, 'ops@example.com');
});

test('web push is off without VAPID keys and on with all three', () => {
  const off = loadConfig({ ...BASE_ENV, NODE_ENV: 'development' });
  assert.equal(off.push, null);
  assert.equal(off.features.push, false);

  const on = loadConfig({
    ...BASE_ENV,
    NODE_ENV: 'development',
    VAPID_PUBLIC_KEY: 'pub',
    VAPID_PRIVATE_KEY: 'priv',
    VAPID_SUBJECT: 'mailto:ops@example.com',
  });
  assert.deepEqual(on.push, { publicKey: 'pub', privateKey: 'priv', subject: 'mailto:ops@example.com' });
  assert.equal(on.features.push, true);
});

test('web push rejects a partial key set or a subject Apple would refuse', () => {
  assert.throws(
    () => loadConfig({ ...BASE_ENV, VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' }),
    /VAPID_SUBJECT/,
  );
  assert.throws(
    () => loadConfig({
      ...BASE_ENV, VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'http://localhost:3002',
    }),
    /mailto: address or an https:\/\/ URL/,
  );
});

test('background jobs default on in production and off elsewhere; the env value wins', () => {
  assert.equal(loadConfig({ ...BASE_ENV, NODE_ENV: 'production' }).runBackgroundJobs, true);
  assert.equal(loadConfig({ ...BASE_ENV, NODE_ENV: 'development' }).runBackgroundJobs, false);
  assert.equal(loadConfig({ ...BASE_ENV, NODE_ENV: 'test' }).runBackgroundJobs, false);
  assert.equal(
    loadConfig({ ...BASE_ENV, NODE_ENV: 'development', RUN_BACKGROUND_JOBS: 'true' }).runBackgroundJobs,
    true,
  );
  assert.equal(
    loadConfig({ ...BASE_ENV, NODE_ENV: 'production', RUN_BACKGROUND_JOBS: 'false' }).runBackgroundJobs,
    false,
  );
  assert.throws(
    () => loadConfig({ ...BASE_ENV, RUN_BACKGROUND_JOBS: 'yes' }),
    /RUN_BACKGROUND_JOBS must be true or false/,
  );
});

test('assertNodeEnvSet fails boot when NODE_ENV is missing or blank', () => {
  assert.throws(() => assertNodeEnvSet({}), /NODE_ENV is not set/);
  assert.throws(() => assertNodeEnvSet({ NODE_ENV: '  ' }), /NODE_ENV is not set/);
  assert.doesNotThrow(() => assertNodeEnvSet({ NODE_ENV: 'development' }));
});
