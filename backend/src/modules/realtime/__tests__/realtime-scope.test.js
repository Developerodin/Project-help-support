import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { ROLE_IDS } from '@pms/shared';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Client from '../../clients/client.model.js';
import Project from '../../projects/project.model.js';
import AccessAssignment from '../../access/accessAssignment.model.js';
import { resolveAuthorizedProjectScope } from '../realtime.service.js';

withMemoryDb();

const password = 'a-long-enough-password';
const uniq = () => Math.random().toString(36).slice(2);

async function user(role) {
  return User.create({
    name: role, email: `${role}-${uniq()}@example.com`, password, role, status: 'active',
  });
}

async function fixture() {
  const staff = await user(ROLE_IDS.ADMIN);
  const client = await Client.create({ name: 'Co', status: 'active', createdBy: staff._id });
  const project = await Project.create({
    key: `P${uniq().slice(0, 3)}`, name: 'Proj', client: client._id, createdBy: staff._id,
  });
  return { staff, client, project };
}

test('a project the caller can see becomes the channel scope', async () => {
  const { staff, project } = await fixture();
  assert.equal(
    await resolveAuthorizedProjectScope(staff, String(project._id)),
    String(project._id),
  );
});

test('a project the caller cannot see drops the scope instead of joining it', async () => {
  const { project } = await fixture();
  // External with no assignment to this client: the projects API would refuse.
  const outsider = await user(ROLE_IDS.CLIENT);

  assert.equal(await resolveAuthorizedProjectScope(outsider, String(project._id)), null);
});

test('an external caller assigned to the client keeps the scope', async () => {
  const { staff, client, project } = await fixture();
  const external = await user(ROLE_IDS.CLIENT);
  await AccessAssignment.create({
    user: external._id, client: client._id, role: ROLE_IDS.CLIENT, grantedBy: staff._id,
  });

  assert.equal(
    await resolveAuthorizedProjectScope(external, String(project._id)),
    String(project._id),
  );
});

test('a missing, blank or malformed project id is no scope at all', async () => {
  const { staff } = await fixture();
  for (const raw of [undefined, null, '', '   ', 'not-an-id', '../../etc']) {
    assert.equal(await resolveAuthorizedProjectScope(staff, raw), null, String(raw));
  }
  // Well-formed but nonexistent: getProject 404s, so still no scope.
  const ghost = String(new mongoose.Types.ObjectId());
  assert.equal(await resolveAuthorizedProjectScope(staff, ghost), null);
});
