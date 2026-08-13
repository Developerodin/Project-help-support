import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../config.js';

const base = {
  MONGODB_URL: 'mongodb://localhost:27017/pms',
  JWT_SECRET: 'a-sufficiently-long-development-secret-value',
  FRONTEND_BASE_URL: 'http://localhost:3000',
  CORS_ORIGINS: 'http://localhost:3000',
};

test('loads with only the required group present', () => {
  const cfg = loadConfig(base);
  assert.equal(cfg.mongoUrl, base.MONGODB_URL);
  assert.equal(cfg.nodeEnv, 'development');
  assert.equal(cfg.port, 4000);
  assert.deepEqual(cfg.corsOrigins, ['http://localhost:3000']);
});

test('throws when a required variable is missing', () => {
  const { MONGODB_URL, ...withoutMongo } = base;
  assert.throws(() => loadConfig(withoutMongo), /MONGODB_URL/);
});

test('absent capability group disables the feature rather than failing boot', () => {
  const cfg = loadConfig(base);
  assert.equal(cfg.features.attachments, false);
  assert.equal(cfg.features.email, false);
  assert.equal(cfg.features.seed, false);
  assert.equal(cfg.storage, null);
  assert.equal(cfg.email, null);
});

test('a fully present capability group enables the feature', () => {
  const cfg = loadConfig({
    ...base,
    AWS_REGION: 'ap-south-1',
    AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE',
    AWS_SECRET_ACCESS_KEY: 'secretexamplevalue',
    S3_BUCKET: 'pms-attachments',
  });
  assert.equal(cfg.features.attachments, true);
  assert.equal(cfg.storage.bucket, 'pms-attachments');
});

test('a partially present capability group is a boot error naming what is missing', () => {
  assert.throws(
    () => loadConfig({ ...base, AWS_REGION: 'ap-south-1', S3_BUCKET: 'pms-attachments' }),
    /storage[\s\S]*AWS_ACCESS_KEY_ID/,
  );
});

test('production rejects a placeholder JWT secret', () => {
  assert.throws(
    () => loadConfig({ ...base, NODE_ENV: 'production', JWT_SECRET: 'changeme' }),
    /placeholder/i,
  );
});

test('production rejects a short JWT secret', () => {
  assert.throws(
    () => loadConfig({ ...base, NODE_ENV: 'production', JWT_SECRET: 'short' }),
    /at least 32/i,
  );
});

test('production rejects a placeholder seed admin password', () => {
  assert.throws(
    () => loadConfig({
      ...base,
      NODE_ENV: 'production',
      SEED_ADMIN_EMAIL: 'admin@example.com',
      SEED_ADMIN_PASSWORD: 'changeme',
    }),
    /placeholder/i,
  );
});

test('cookie.secure is true in production and false in development', () => {
  assert.equal(loadConfig(base).cookie.secure, false);
  assert.equal(loadConfig({ ...base, NODE_ENV: 'production' }).cookie.secure, true);
});

test('CORS_ORIGINS splits and trims a comma separated list', () => {
  const cfg = loadConfig({ ...base, CORS_ORIGINS: 'https://a.example.com, https://b.example.com' });
  assert.deepEqual(cfg.corsOrigins, ['https://a.example.com', 'https://b.example.com']);
});
