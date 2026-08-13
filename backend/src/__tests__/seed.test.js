import test from 'node:test';
import assert from 'node:assert/strict';
import { withMemoryDb } from '../platform/__tests__/helpers/memoryDb.js';
import User from '../modules/users/user.model.js';
import { seedAdmin } from '../seed.js';

withMemoryDb();

const withSeed = {
  isProduction: false,
  features: { seed: true },
  seed: { adminEmail: 'Admin@Example.com', adminPassword: 'a-real-admin-password' },
};
const withoutSeed = { isProduction: false, features: { seed: false }, seed: null };

test('creates an active admin when the users collection is empty', async () => {
  const result = await seedAdmin(withSeed);
  assert.equal(result.created, true);

  const admin = await User.findOne({ email: 'admin@example.com' }).select('+password');
  assert.equal(admin.role, 'admin');
  assert.equal(admin.status, 'active');
  assert.equal(await admin.isPasswordMatch('a-real-admin-password'), true);
});

test('is idempotent — a second run creates nothing', async () => {
  await seedAdmin(withSeed);
  const second = await seedAdmin(withSeed);

  assert.equal(second.created, false);
  assert.equal(await User.countDocuments(), 1);
});

test('does nothing when users already exist, even with a different seed email', async () => {
  await User.create({
    name: 'Someone', email: 'someone@example.com', password: 'a-password-value', status: 'active',
  });

  const result = await seedAdmin(withSeed);
  assert.equal(result.created, false);
  assert.equal(await User.countDocuments(), 1);
});

test('throws when the collection is empty and no seed group is configured', async () => {
  await assert.rejects(
    () => seedAdmin(withoutSeed),
    /SEED_ADMIN_EMAIL/,
    'boot must fail rather than start an installation nobody can log into',
  );
});

test('does not throw when the seed group is absent but users already exist', async () => {
  await User.create({
    name: 'Someone', email: 'someone@example.com', password: 'a-password-value', status: 'active',
  });
  const result = await seedAdmin(withoutSeed);
  assert.equal(result.created, false);
});
