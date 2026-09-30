import test from 'node:test';
import assert from 'node:assert/strict';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../user.model.js';
import { listUsers, getUser, updateUser, deleteUser, isAccountDeleted, migrateLegacyUserRoles } from '../user.service.js';

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

test('deactivating a user ends their sessions and drops any pending reset token', async () => {
  const admin = await makeUser('admin');
  const target = await makeUser('developer', {
    inviteTokenHash: 'h'.repeat(64),
    inviteTokenExpiresAt: new Date(Date.now() + 3600000),
    refreshTokens: [{ tokenHash: 'r'.repeat(64), expiresAt: new Date(Date.now() + 3600000) }],
  });

  await updateUser(admin, target.id, { status: 'inactive' });

  const stored = await User.findById(target.id).select('+inviteTokenHash +inviteTokenExpiresAt +refreshTokens');
  assert.equal(stored.status, 'inactive');
  assert.equal(stored.inviteTokenHash, undefined);
  assert.equal(stored.inviteTokenExpiresAt, undefined);
  assert.equal(stored.refreshTokens.length, 0);
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

test('deleteUser soft-deletes without clearing ticket assignments', async () => {
  const admin = await makeUser('admin');
  const target = await makeUser('developer');
  const Ticket = (await import('../../tickets/ticket.model.js')).default;
  const Project = (await import('../../projects/project.model.js')).default;
  const project = await Project.create({ key: 'SOFT', name: 'Soft delete', createdBy: admin._id });
  await Ticket.create({
    ticketId: 'SOFT-1', project: project._id, title: 'Keep assignee',
    createdBy: admin._id, assignedTo: target._id, status: 'pending',
  });

  await deleteUser(admin, target.id);

  const kept = await User.findById(target.id);
  assert.equal(kept.status, 'deleted');
  assert.equal(kept.name, target.name);
  assert.equal(kept.email, target.email);
  const ticket = await Ticket.findOne({ ticketId: 'SOFT-1' });
  assert.equal(String(ticket.assignedTo), String(target._id));
});

test('isAccountDeleted recognises legacy scrubbed rows', async () => {
  const scrubbed = await User.create({
    name: 'Deleted User',
    email: 'deleted+6a81c91f3f865bf032201e0e@internal',
    password: 'a-long-enough-password',
    status: 'inactive',
  });
  assert.equal(isAccountDeleted(scrubbed), true);
});

test('migrateLegacyUserRoles remaps pre-v2 literals and backfills roles[]', async () => {
  await User.collection.insertMany([
    {
      name: 'Lead', email: 'lead@example.com', password: 'a-long-enough-password',
      role: 'lead', status: 'active', createdAt: new Date(), updatedAt: new Date(),
    },
    {
      name: 'QA', email: 'qa@example.com', password: 'a-long-enough-password',
      role: 'qa', status: 'active', createdAt: new Date(), updatedAt: new Date(),
    },
    {
      name: 'Member', email: 'member@example.com', password: 'a-long-enough-password',
      role: 'member', status: 'active', createdAt: new Date(), updatedAt: new Date(),
    },
    {
      name: 'Legacy Admin', email: 'legacy-admin@example.com', password: 'a-long-enough-password',
      role: 'admin', status: 'active', createdAt: new Date(), updatedAt: new Date(),
    },
  ]);

  const first = await migrateLegacyUserRoles();
  assert.equal(first.migrated, 4);

  const lead = await User.findOne({ email: 'lead@example.com' });
  assert.deepEqual(lead.roles, ['project_admin']);
  assert.equal(lead.role, 'project_admin');

  const qa = await User.findOne({ email: 'qa@example.com' });
  assert.deepEqual(qa.roles, ['tester']);

  const member = await User.findOne({ email: 'member@example.com' });
  assert.deepEqual(member.roles, ['read_only']);

  const legacyAdmin = await User.findOne({ email: 'legacy-admin@example.com' });
  assert.deepEqual(legacyAdmin.roles, ['admin']);

  const second = await migrateLegacyUserRoles();
  assert.equal(second.migrated, 0);
});

test('migrateLegacyUserRoles skips super admin rows', async () => {
  await User.collection.insertOne({
    name: 'Root', email: 'root@example.com', password: 'a-long-enough-password',
    role: 'super_admin', status: 'active', createdAt: new Date(), updatedAt: new Date(),
  });

  const result = await migrateLegacyUserRoles();
  assert.equal(result.migrated, 0);
  assert.equal(result.skipped, 1);

  const raw = await User.collection.findOne({ email: 'root@example.com' });
  assert.equal(raw.role, 'super_admin');
  assert.equal(raw.roles, undefined);
});

test('updateUser refuses to demote or deactivate the last active admin', async () => {
  const actor = await makeUser('project_admin');
  const onlyAdmin = await makeUser('admin');
  await User.updateMany({ _id: { $ne: onlyAdmin._id }, roles: 'admin' }, { $set: { status: 'inactive' } });
  await User.updateMany({ _id: { $ne: onlyAdmin._id }, role: 'admin' }, { $set: { status: 'inactive' } });

  await assert.rejects(updateUser(actor, onlyAdmin.id, { status: 'inactive' }), (err) => err.code === 'LAST_ADMIN');
  await assert.rejects(updateUser(actor, onlyAdmin.id, { role: 'developer' }), (err) => err.code === 'LAST_ADMIN');
  assert.equal((await User.findById(onlyAdmin.id)).status, 'active');
});

test('updateUser reverts and answers 409 when a concurrent change removed the other admin', async () => {
  const actor = await makeUser('project_admin');
  const a = await makeUser('admin');
  const b = await makeUser('admin');
  await User.updateMany({ _id: { $nin: [a._id, b._id] }, role: 'admin' }, { $set: { status: 'inactive' } });

  const original = User.findByIdAndUpdate;
  User.findByIdAndUpdate = async function racing(...args) {
    User.findByIdAndUpdate = original;
    // The other admin is deactivated after our pre-check passed.
    await User.updateOne({ _id: b._id }, { $set: { status: 'inactive' } });
    return original.apply(this, args);
  };
  try {
    await assert.rejects(updateUser(actor, a.id, { status: 'inactive' }), (err) => err.statusCode === 409);
  } finally {
    User.findByIdAndUpdate = original;
  }
  assert.equal((await User.findById(a.id)).status, 'active');
});

test('deleteUser logs who was deleted in the audit row', async () => {
  const { default: RbacAuditLog } = await import('../../rbac/rbacAuditLog.model.js');
  const admin = await makeUser('admin');
  const target = await makeUser('developer');
  await deleteUser(admin, target.id);
  const row = await RbacAuditLog.findOne({ action: 'user.delete' }).lean();
  assert.equal(row.details.email, target.email);
  assert.equal(row.details.name, target.name);
});
