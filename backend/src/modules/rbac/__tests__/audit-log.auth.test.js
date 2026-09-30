import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { ROLE_IDS } from '@pms/shared';
import {
  startTestDb,
  stopTestDb,
  createTestApp,
  createActiveUser,
  bearerToken,
  grantRoleMatrixCustomization,
  getTestConfig,
} from '../../../test/test-harness.js';
import { loadPermissionContextForUser } from '../rbac.service.js';
import { listAuditLog } from '../rbac.service.js';

describe('rbac audit log authorization', () => {
  let app;
  let config;
  let admin;
  let auditor;
  let stripped;

  before(async () => {
    await startTestDb();
    app = createTestApp();
    config = getTestConfig();

    admin = await createActiveUser({
      email: 'admin-audit@example.com',
      name: 'Admin',
      roles: [ROLE_IDS.ADMIN],
    });

    auditor = await createActiveUser({
      email: 'auditor@example.com',
      name: 'Auditor',
      roles: [ROLE_IDS.TESTER],
    });

    stripped = await createActiveUser({
      email: 'no-audit@example.com',
      name: 'No Audit',
      roles: [ROLE_IDS.TESTER],
    });

    await grantRoleMatrixCustomization(admin._id, ROLE_IDS.TESTER, { add: ['audit.view'] });
  });

  after(async () => {
    await stopTestDb();
  });

  it('returns 200 for non-admin with matrix grant audit.view', async () => {
    const ctx = await loadPermissionContextForUser(auditor._id);
    await listAuditLog(auditor, { page: 1, limit: 10 }, { permissionContext: ctx });

    const res = await request(app)
      .get('/v1/rbac/audit-log')
      .set('Authorization', bearerToken(auditor, config));
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.results));
  });

  it('returns 403 when audit.view is stripped from role', async () => {
    await grantRoleMatrixCustomization(admin._id, ROLE_IDS.TESTER, { remove: ['audit.view'] });
    const res = await request(app)
      .get('/v1/rbac/audit-log')
      .set('Authorization', bearerToken(stripped, config));
    assert.equal(res.status, 403);
    await grantRoleMatrixCustomization(admin._id, ROLE_IDS.TESTER, { add: ['audit.view'] });
  });

  it('returns the policy editor by id, name and email, not a role', async () => {
    const auth = bearerToken(admin, config);
    const matrixSave = await request(app)
      .put('/v1/rbac/role-matrix')
      .set('Authorization', auth)
      .send({ grants: {} });
    assert.equal(matrixSave.status, 200);
    const boardSave = await request(app)
      .put('/v1/rbac/board-permissions')
      .set('Authorization', auth)
      .send({ grants: {} });
    assert.equal(boardSave.status, 200);

    for (const action of ['role_matrix.update', 'board_permissions.update']) {
      const res = await request(app)
        .get('/v1/rbac/audit-log')
        .query({ action, limit: 1 })
        .set('Authorization', auth);
      assert.equal(res.status, 200);
      const [row] = res.body.results;
      assert.equal(row.action, action);
      assert.deepEqual(
        { id: row.actor.id, name: row.actor.name, email: row.actor.email },
        { id: String(admin._id), name: 'Admin', email: 'admin-audit@example.com' },
      );
    }
  });

  it('allows impersonated session when initiator has audit.view', async () => {
    await grantRoleMatrixCustomization(admin._id, ROLE_IDS.TESTER, { remove: ['audit.view'] });
    const token = bearerToken(stripped, config, { impersonatedBy: admin._id });
    const res = await request(app).get('/v1/rbac/audit-log').set('Authorization', token);
    assert.equal(res.status, 200);
    await grantRoleMatrixCustomization(admin._id, ROLE_IDS.TESTER, { add: ['audit.view'] });
  });
});
