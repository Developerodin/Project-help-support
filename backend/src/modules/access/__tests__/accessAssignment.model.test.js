import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { ROLE_IDS } from '@pms/shared';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import AccessAssignment from '../accessAssignment.model.js';

withMemoryDb();

const id = () => new mongoose.Types.ObjectId();
const base = () => ({ user: id(), role: ROLE_IDS.TESTER, grantedBy: id() });

test('a global assignment (client and project both null) is valid', async () => {
  const a = await AccessAssignment.create(base());
  assert.equal(a.client, null);
  assert.equal(a.project, null);
  assert.equal(a.status, 'active');
  assert.deepEqual(a.environments, []);
});

test('project cannot be set without client', async () => {
  await assert.rejects(() => AccessAssignment.create({ ...base(), project: id() }));
});

test('project is valid when client is also set', async () => {
  const a = await AccessAssignment.create({ ...base(), client: id(), project: id() });
  assert.ok(a.project);
});

test('environments are deduplicated on set', async () => {
  const a = await AccessAssignment.create({
    ...base(), environments: ['Staging', 'Staging', 'Production'], reason: 'release prep',
  });
  assert.deepEqual([...a.environments].sort(), ['Production', 'Staging']);
});

test('an unrecognized environment value is rejected', async () => {
  await assert.rejects(() => AccessAssignment.create({ ...base(), environments: ['QA-Sandbox'] }));
});

test('reason is required when granting Production access', async () => {
  await assert.rejects(
    () => AccessAssignment.create({ ...base(), environments: ['Production'] }),
    (err) => /reason/i.test(err.message),
  );
  const withReason = await AccessAssignment.create({
    ...base(), environments: ['Production'], reason: 'incident response',
  });
  assert.ok(withReason);
});

test('reason is required when suspending or revoking', async () => {
  const active = await AccessAssignment.create(base());
  active.status = 'suspended';
  await assert.rejects(() => active.save());

  active.reason = 'temporary leave';
  await active.save();
  assert.equal(active.status, 'suspended');
});

test('reason is not required for an ordinary active grant with no Production access', async () => {
  const a = await AccessAssignment.create({ ...base(), environments: ['Staging'] });
  assert.equal(a.reason, undefined);
});

test('expiresAt must be in the future when set', async () => {
  await assert.rejects(() => AccessAssignment.create({ ...base(), expiresAt: new Date(Date.now() - 1000) }));
  const a = await AccessAssignment.create({ ...base(), expiresAt: new Date(Date.now() + 86400000) });
  assert.ok(a.expiresAt);
});

test('status accepts revoked, matching this codebase\'s status-enum-not-hard-delete convention', async () => {
  const a = await AccessAssignment.create(base());
  a.status = 'revoked';
  a.reason = 'no longer needed';
  await a.save();
  assert.equal(a.status, 'revoked');
});
