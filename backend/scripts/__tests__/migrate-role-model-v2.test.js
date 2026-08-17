// backend/scripts/__tests__/migrate-role-model-v2.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { withMemoryDb } from '../../src/platform/__tests__/helpers/memoryDb.js';
import User from '../../src/modules/users/user.model.js';
import { planRoleMigration, applyRoleMigration, ROLE_MIGRATION_MAP } from '../migrate-role-model-v2.js';

withMemoryDb();

// 'lead'/'qa'/'member' are no longer valid against the current User schema —
// inserted via the native driver to bypass Mongoose validation, simulating
// pre-migration legacy data.
async function insertLegacyUser(role, email) {
  await User.collection.insertOne({
    _id: new mongoose.Types.ObjectId(),
    name: 'Legacy', email, password: 'hashed-placeholder', role, status: 'active',
    createdAt: new Date(), updatedAt: new Date(),
  });
}

test('ROLE_MIGRATION_MAP covers exactly the old five role values, and member maps to read_only, not developer', () => {
  assert.deepEqual(Object.keys(ROLE_MIGRATION_MAP).sort(), ['admin', 'developer', 'lead', 'member', 'qa']);
  assert.equal(ROLE_MIGRATION_MAP.member, 'read_only');
});

test('planRoleMigration counts users per old role without writing anything', async () => {
  await insertLegacyUser('lead', 'l@example.com');
  await insertLegacyUser('qa', 'q@example.com');
  await insertLegacyUser('member', 'm1@example.com');
  await insertLegacyUser('member', 'm2@example.com');

  const plan = await planRoleMigration();
  assert.equal(plan.lead, 1);
  assert.equal(plan.qa, 1);
  assert.equal(plan.member, 2);
  assert.equal(plan.admin, 0);

  const stillLegacy = await User.collection.findOne({ email: 'l@example.com' });
  assert.equal(stillLegacy.role, 'lead', 'a dry run must not write');
});

test('applyRoleMigration rewrites every old role to its mapped new role, member to read_only', async () => {
  await insertLegacyUser('lead', 'l@example.com');
  await insertLegacyUser('qa', 'q@example.com');
  await insertLegacyUser('member', 'm@example.com');
  await insertLegacyUser('developer', 'd@example.com');

  const results = await applyRoleMigration();
  assert.equal(results.lead, 1);
  assert.equal(results.qa, 1);
  assert.equal(results.member, 1);

  assert.equal((await User.findOne({ email: 'l@example.com' })).role, 'project_admin');
  assert.equal((await User.findOne({ email: 'q@example.com' })).role, 'tester');
  assert.equal((await User.findOne({ email: 'm@example.com' })).role, 'read_only');
  assert.equal((await User.findOne({ email: 'd@example.com' })).role, 'developer');
});

test('applyRoleMigration is idempotent — a second run touches nothing', async () => {
  await insertLegacyUser('member', 'm@example.com');
  await applyRoleMigration();
  const second = await applyRoleMigration();
  assert.equal(second.member, 0);
});
