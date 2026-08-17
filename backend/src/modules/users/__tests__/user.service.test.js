import test from 'node:test';
import assert from 'node:assert/strict';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../user.model.js';
import { listUsers, getUser, updateUser, deleteUser } from '../user.service.js';

withMemoryDb();

let n = 0;
const makeUser = (role, over = {}) => {
  n += 1;
  return User.create({
    name: `User ${n}`, email: `u${n}@example.com`, password: 'a-long-enough-password',
    status: 'active', role, ...over,
  });
};

test('listUsers hides Super Admin from a non-Super-Admin actor by default', async () => {
  await makeUser('super_admin');
  const admin = await makeUser('admin');

  const page = await listUsers(admin, {});
  assert.ok(!page.results.some((u) => u.role === 'super_admin'));
});

test('listUsers still hides Super Admin from a Super Admin actor', async () => {
  await makeUser('super_admin');
  const actingSuperAdmin = await makeUser('super_admin');

  const page = await listUsers(actingSuperAdmin, {});
  assert.equal(page.results.filter((u) => u.role === 'super_admin').length, 0);
});

test('listUsers never returns Super Admin even when role filter asks for it', async () => {
  await makeUser('super_admin');
  const admin = await makeUser('admin');

  const page = await listUsers(admin, { role: 'super_admin' });
  assert.equal(page.results.length, 0);
});

test('getUser returns 404 for a Super Admin target seen by a non-Super-Admin actor', async () => {
  const superAdmin = await makeUser('super_admin');
  const admin = await makeUser('admin');

  const err = await getUser(admin, superAdmin.id).catch((e) => e);
  assert.equal(err.statusCode, 404);
  assert.equal(err.code, 'USER_NOT_FOUND');
});

test('getUser still returns 404 for a Super Admin actor viewing another Super Admin through normal API', async () => {
  const superAdmin = await makeUser('super_admin');
  const otherSuperAdmin = await makeUser('super_admin');

  const err = await getUser(superAdmin, otherSuperAdmin.id).catch((e) => e);
  assert.equal(err.statusCode, 404);
});

test('updateUser rejects an Admin promoting anyone to Super Admin', async () => {
  const admin = await makeUser('admin');
  const target = await makeUser('developer');

  const err = await updateUser(admin, target.id, { role: 'super_admin' }).catch((e) => e);
  assert.equal(err.statusCode, 403);
  assert.equal(err.code, 'SUPER_ADMIN_PROTECTED');
});

test('updateUser also rejects a Super Admin promoting someone to Super Admin in normal People API', async () => {
  const superAdmin = await makeUser('super_admin');
  const target = await makeUser('developer');

  const err = await updateUser(superAdmin, target.id, { role: 'super_admin' }).catch((e) => e);
  assert.equal(err.statusCode, 403);
  assert.equal(err.code, 'SUPER_ADMIN_PROTECTED');
});

test('updateUser hides an existing Super Admin from a non-Super-Admin actor as 404', async () => {
  const existingSuperAdmin = await makeUser('super_admin');
  const admin = await makeUser('admin');

  const err = await updateUser(admin, existingSuperAdmin.id, { status: 'inactive' }).catch((e) => e);
  assert.equal(err.statusCode, 404);
});

test('deleteUser hides Super Admin from delete attempts through normal API even when another Super Admin exists', async () => {
  const superAdmin = await makeUser('super_admin');
  const otherSuperAdminActor = await makeUser('super_admin');

  const err = await deleteUser(otherSuperAdminActor, superAdmin.id).catch((e) => e);
  assert.equal(err.statusCode, 404);
});

test('deleteUser blocks removing the last Super Admin', async () => {
  const onlySuperAdmin = await makeUser('super_admin');
  const admin = await makeUser('admin');

  const err = await deleteUser(admin, onlySuperAdmin.id).catch((e) => e);
  assert.equal(err.statusCode, 404);
});
