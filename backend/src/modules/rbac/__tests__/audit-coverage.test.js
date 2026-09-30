import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { ROLE_IDS } from '@pms/shared';
import RbacAuditLog from '../rbacAuditLog.model.js';
import { recordRbacAudit } from '../rbac-audit.js';
import {
  startTestDb,
  stopTestDb,
  createTestApp,
  createActiveUser,
  bearerToken,
  grantRoleMatrixCustomization,
  getTestConfig,
} from '../../../test/test-harness.js';
import { listAuditLog } from '../rbac.service.js';
import { loadPermissionContextForUser } from '../rbac.service.js';
import Client from '../../clients/client.model.js';

describe('rbac audit coverage', () => {
  let app;
  let config;
  let admin;
  let target;
  let auditor;

  before(async () => {
    await startTestDb();
    app = createTestApp();
    config = getTestConfig();

    admin = await createActiveUser({
      email: 'audit-admin@example.com',
      name: 'Audit Admin',
      roles: [ROLE_IDS.ADMIN],
    });
    target = await createActiveUser({
      email: 'audit-target@example.com',
      name: 'Audit Target',
      roles: [ROLE_IDS.TESTER],
    });
    auditor = await createActiveUser({
      email: 'audit-viewer@example.com',
      name: 'Audit Viewer',
      roles: [ROLE_IDS.TESTER],
    });

    await grantRoleMatrixCustomization(admin._id, ROLE_IDS.TESTER, { add: ['audit.view'] });
  });

  after(async () => {
    await stopTestDb();
  });

  it('persists impersonation initiator on scoped assignment audit rows', async () => {
    await recordRbacAudit(
      target,
      'scoped_assignment.create',
      {
        userId: String(target._id),
        assignmentId: '507f1f77bcf86cd799439011',
        role: ROLE_IDS.PROJECT_ADMIN,
      },
      { initiatorUserId: admin._id },
    );

    const row = await RbacAuditLog.findOne({ action: 'scoped_assignment.create' }).sort({ createdAt: -1 });
    assert.ok(row);
    assert.equal(String(row.actor), String(target._id));
    assert.equal(String(row.initiator), String(admin._id));
  });

  it('filters audit log by actorId', async () => {
    await RbacAuditLog.create({
      action: 'user.update',
      category: 'security',
      actor: admin._id,
      targetUser: target._id,
      details: { userId: String(target._id) },
    });

    const ctx = await loadPermissionContextForUser(auditor._id);
    const page = await listAuditLog(
      auditor,
      { page: 1, limit: 20, actorId: String(admin._id) },
      { permissionContext: ctx },
    );

    assert.ok(page.results.length >= 1);
    assert.ok(page.results.every((row) => String(row.actor?.id || row.actor) === String(admin._id)));
  });

  it('records bulk company sync access audit events', async () => {
    const client = await Client.create({
      name: `Audit Co ${Date.now()}`,
      status: 'active',
      createdBy: admin._id,
    });
    const external = await createActiveUser({
      email: `client-user-${Date.now()}@example.com`,
      roles: [ROLE_IDS.CLIENT],
    });

    const res = await request(app)
      .patch(`/v1/clients/${client._id}`)
      .set('Authorization', bearerToken(admin, config))
      .send({ clientUserIds: [String(external._id)] });

    assert.equal(res.status, 200);

    const row = await RbacAuditLog.findOne({
      action: 'scoped_assignment.company_sync',
      actor: admin._id,
    }).sort({ createdAt: -1 });
    assert.ok(row);
    assert.ok(row.details.addedCount >= 1);
  });

  it('records durable security impersonation start and stop events', async () => {
    const victim = await createActiveUser({
      email: `impersonated-${Date.now()}@example.com`,
      roles: [ROLE_IDS.TESTER],
    });

    const login = await request(app)
      .post('/v1/auth/login')
      .send({ email: admin.email, password: 'password12345' });
    assert.equal(login.status, 200);
    const adminRefresh = login.headers['set-cookie']?.find((c) => c.startsWith('prowplus_refreshToken='));
    assert.ok(adminRefresh);

    const start = await request(app)
      .post(`/v1/auth/impersonate/${victim._id}`)
      .set('Authorization', bearerToken(admin, config))
      .set('Cookie', adminRefresh.split(';')[0]);
    assert.equal(start.status, 200);

    const startRow = await RbacAuditLog.findOne({ action: 'security.impersonation.start' }).sort({ createdAt: -1 });
    assert.ok(startRow);
    assert.equal(String(startRow.targetUser), String(victim._id));
    assert.equal(startRow.category, 'security');

    const startCookies = start.headers['set-cookie'] || [];
    const cookieHeader = startCookies.map((c) => c.split(';')[0]).join('; ');
    const impToken = bearerToken(victim, config, { impersonatedBy: admin._id });
    const stop = await request(app)
      .post('/v1/auth/stop-impersonation')
      .set('Authorization', impToken)
      .set('Cookie', cookieHeader);
    assert.equal(stop.status, 200);

    const stopRow = await RbacAuditLog.findOne({ action: 'security.impersonation.stop' }).sort({ createdAt: -1 });
    assert.ok(stopRow);
    assert.equal(stopRow.category, 'security');
    assert.equal(String(stopRow.initiator), String(admin._id));
  });

  it('records user.update audit on role or status changes', async () => {
    const subject = await createActiveUser({
      email: `subject-${Date.now()}@example.com`,
      roles: [ROLE_IDS.TESTER],
    });

    const res = await request(app)
      .patch(`/v1/users/${subject._id}`)
      .set('Authorization', bearerToken(admin, config))
      .send({ status: 'inactive' });

    assert.equal(res.status, 200);

    const row = await RbacAuditLog.findOne({
      action: 'user.update',
      targetUser: subject._id,
    }).sort({ createdAt: -1 });
    assert.ok(row);
    assert.equal(row.details.previous.status, 'active');
    assert.equal(row.details.next.status, 'inactive');
  });
});
