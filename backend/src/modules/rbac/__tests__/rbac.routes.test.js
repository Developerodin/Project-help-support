import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS } from '@pms/shared';
import request from 'supertest';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Client from '../../clients/client.model.js';
import Project from '../../projects/project.model.js';
import RbacAuditLog from '../rbacAuditLog.model.js';
import { createApp } from '../../../app.js';
import { generateAccessToken } from '../../auth/token.service.js';

withMemoryDb();

const config = {
  nodeEnv: 'test', isProduction: false, port: 4000, mongoUrl: 'mongodb://unused',
  frontendBaseUrl: 'http://localhost:3000', corsOrigins: ['http://localhost:3000'],
  jwt: {
    secret: 'a-sufficiently-long-test-secret-value-here',
    accessExpirationMinutes: 15, refreshExpirationDays: 30,
  },
  cookie: { domain: undefined, secure: false },
  features: { attachments: false, email: false, seed: false },
  storage: null, email: null, seed: null,
};

const app = () => createApp(config);
const bearer = (user) => `Bearer ${generateAccessToken(user, config)}`;

async function makeAdmin() {
  return User.create({
    name: 'Admin',
    email: `admin-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-long-enough-password',
    status: 'active',
    role: ROLE_IDS.ADMIN,
    roles: [ROLE_IDS.ADMIN],
  });
}

async function seedScope(admin) {
  const client = await Client.create({ name: `Client-${Math.random().toString(36).slice(2)}`, status: 'active', createdBy: admin._id });
  const project = await Project.create({
    key: `K${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    name: 'Portal',
    client: client._id,
    status: 'active',
    createdBy: admin._id,
  });
  return { client, project };
}

test('PUT /v1/rbac/role-matrix allows admin to grant read_only permissions', async () => {
  const admin = await makeAdmin();

  const baseline = await request(app())
    .get('/v1/rbac/role-matrix')
    .set('Authorization', bearer(admin))
    .expect(200);

  const readOnlyGrants = [...baseline.body.effective[ROLE_IDS.READ_ONLY], 'tickets.create'];
  const updated = await request(app())
    .put('/v1/rbac/role-matrix')
    .set('Authorization', bearer(admin))
    .send({ grants: { [ROLE_IDS.READ_ONLY]: readOnlyGrants } })
    .expect(200);

  assert.ok(updated.body.effective[ROLE_IDS.READ_ONLY].includes('tickets.create'));

  const reloaded = await request(app())
    .get('/v1/rbac/role-matrix')
    .set('Authorization', bearer(admin))
    .expect(200);

  assert.ok(reloaded.body.effective[ROLE_IDS.READ_ONLY].includes('tickets.create'));
});

test('PUT /v1/rbac/role-matrix partial payload preserves unrelated customizations', async () => {
  const admin = await makeAdmin();

  const baseline = await request(app())
    .get('/v1/rbac/role-matrix')
    .set('Authorization', bearer(admin))
    .expect(200);

  const developerGrants = [...baseline.body.effective[ROLE_IDS.DEVELOPER], 'tickets.accept'];
  await request(app())
    .put('/v1/rbac/role-matrix')
    .set('Authorization', bearer(admin))
    .send({ grants: { [ROLE_IDS.DEVELOPER]: developerGrants } })
    .expect(200);

  const projectAdminGrants = [...baseline.body.effective[ROLE_IDS.PROJECT_ADMIN], 'tickets.delete'];
  const updated = await request(app())
    .put('/v1/rbac/role-matrix')
    .set('Authorization', bearer(admin))
    .send({ grants: { [ROLE_IDS.PROJECT_ADMIN]: projectAdminGrants } })
    .expect(200);

  assert.ok(
    updated.body.effective[ROLE_IDS.DEVELOPER].includes('tickets.accept'),
    'developer customization must survive a partial update to another role',
  );
  assert.ok(updated.body.effective[ROLE_IDS.PROJECT_ADMIN].includes('tickets.delete'));
});

test('POST /v1/rbac/users/:userId/scoped-assignments creates and lists assignment', async () => {
  const admin = await makeAdmin();
  const developer = await User.create({
    name: 'Dev',
    email: `dev-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-long-enough-password',
    status: 'active',
    role: ROLE_IDS.DEVELOPER,
    roles: [ROLE_IDS.DEVELOPER],
  });
  const { client, project } = await seedScope(admin);

  const created = await request(app())
    .post(`/v1/rbac/users/${developer._id}/scoped-assignments`)
    .set('Authorization', bearer(admin))
    .send({
      role: ROLE_IDS.DEVELOPER,
      clientId: client._id,
      projectId: project._id,
      environments: ['Staging'],
      reason: 'Project delivery',
    })
    .expect(201);

  assert.equal(created.body.role, ROLE_IDS.DEVELOPER);

  const listed = await request(app())
    .get(`/v1/rbac/users/${developer._id}/scoped-assignments`)
    .set('Authorization', bearer(admin))
    .expect(200);

  assert.equal(listed.body.assignments.length, 1);
  assert.equal(listed.body.assignments[0].status, 'active');
});

test('POST /v1/rbac/scoped-assignments/:id/revoke requires reason and access.revoke', async () => {
  const admin = await makeAdmin();
  const developer = await User.create({
    name: 'Dev2',
    email: `dev2-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-long-enough-password',
    status: 'active',
    role: ROLE_IDS.DEVELOPER,
    roles: [ROLE_IDS.DEVELOPER],
  });
  const { client, project } = await seedScope(admin);

  const created = await request(app())
    .post(`/v1/rbac/users/${developer._id}/scoped-assignments`)
    .set('Authorization', bearer(admin))
    .send({
      role: ROLE_IDS.DEVELOPER,
      clientId: client._id,
      projectId: project._id,
      environments: ['Staging'],
      reason: 'Project delivery',
    })
    .expect(201);

  await request(app())
    .post(`/v1/rbac/scoped-assignments/${created.body.id}/revoke`)
    .set('Authorization', bearer(admin))
    .send({ reason: 'No longer needed' })
    .expect(200);

  const listed = await request(app())
    .get(`/v1/rbac/users/${developer._id}/scoped-assignments`)
    .set('Authorization', bearer(admin))
    .expect(200);

  assert.equal(listed.body.assignments[0].status, 'revoked');
});

test('GET /v1/rbac/audit-log returns persisted policy mutations', async () => {
  const admin = await makeAdmin();
  const baseline = await request(app())
    .get('/v1/rbac/role-matrix')
    .set('Authorization', bearer(admin))
    .expect(200);

  await request(app())
    .put('/v1/rbac/role-matrix')
    .set('Authorization', bearer(admin))
    .send({
      grants: {
        [ROLE_IDS.SUPPORT]: [...baseline.body.effective[ROLE_IDS.SUPPORT], 'tickets.accept'],
      },
    })
    .expect(200);

  const audit = await request(app())
    .get('/v1/rbac/audit-log')
    .set('Authorization', bearer(admin))
    .expect(200);

  assert.ok(audit.body.totalResults >= 1);
  assert.ok(audit.body.results.some((row) => row.action === 'role_matrix.update'));
});

async function seedAuditTrail(admin) {
  const base = Date.parse('2026-09-01T00:00:00.000Z');
  const rows = [];
  for (let i = 0; i < 5; i += 1) {
    rows.push({
      category: 'whatsapp', action: 'whatsapp.unknown_sender', actor: null, createdAt: new Date(base + i * 60_000),
    });
  }
  for (let i = 0; i < 3; i += 1) {
    rows.push({
      category: 'policy', action: 'role_matrix.update', actor: admin._id, createdAt: new Date(base + i * 60_000),
    });
  }
  rows.push({
    category: 'access', action: 'scoped_assignment.create', actor: admin._id, createdAt: new Date(base),
  });
  await RbacAuditLog.insertMany(rows);
}

test('GET /v1/rbac/audit-log filters by category and pages in the database', async () => {
  const admin = await makeAdmin();
  await seedAuditTrail(admin);

  const first = await request(app())
    .get('/v1/rbac/audit-log?category=whatsapp&page=1&limit=2')
    .set('Authorization', bearer(admin))
    .expect(200);
  const second = await request(app())
    .get('/v1/rbac/audit-log?category=whatsapp&page=2&limit=2')
    .set('Authorization', bearer(admin))
    .expect(200);
  const last = await request(app())
    .get('/v1/rbac/audit-log?category=whatsapp&page=3&limit=2')
    .set('Authorization', bearer(admin))
    .expect(200);

  assert.equal(second.body.totalResults, 5);
  assert.equal(second.body.totalPages, 3);
  assert.equal(second.body.page, 2);
  assert.equal(second.body.limit, 2);
  assert.equal(second.body.results.length, 2);
  assert.equal(last.body.results.length, 1);

  const pages = [first, second, last].flatMap((res) => res.body.results);
  assert.ok(pages.every((row) => row.category === 'whatsapp'));
  assert.equal(new Set(pages.map((row) => row.id)).size, 5);
  const times = pages.map((row) => Date.parse(row.createdAt));
  assert.deepEqual(times, [...times].sort((a, b) => b - a));
  assert.ok(pages.every((row) => row.subjectNames && typeof row.subjectNames === 'object'));
});

test('GET /v1/rbac/audit-log applies action text, actor and oldest-first sort on the server', async () => {
  const admin = await makeAdmin();
  await seedAuditTrail(admin);

  const byAction = await request(app())
    .get('/v1/rbac/audit-log?action=MATRIX&sortBy=createdAt:asc&limit=2')
    .set('Authorization', bearer(admin))
    .expect(200);
  assert.equal(byAction.body.totalResults, 3);
  assert.equal(byAction.body.totalPages, 2);
  assert.ok(byAction.body.results.every((row) => row.action === 'role_matrix.update'));
  const times = byAction.body.results.map((row) => Date.parse(row.createdAt));
  assert.deepEqual(times, [...times].sort((a, b) => a - b));

  const byActor = await request(app())
    .get(`/v1/rbac/audit-log?actorId=${admin._id}&category=access`)
    .set('Authorization', bearer(admin))
    .expect(200);
  assert.equal(byActor.body.totalResults, 1);
  assert.equal(byActor.body.results[0].action, 'scoped_assignment.create');

  const regexChars = await request(app())
    .get('/v1/rbac/audit-log?action=.*')
    .set('Authorization', bearer(admin))
    .expect(200);
  assert.equal(regexChars.body.totalResults, 0);
});

test('GET /v1/rbac/audit-log rejects sort fields outside the allow-list', async () => {
  const admin = await makeAdmin();
  await request(app())
    .get('/v1/rbac/audit-log?sortBy=details.secret:asc')
    .set('Authorization', bearer(admin))
    .expect(400);
});

test('PUT /v1/rbac/role-matrix rejects non-admin escalation attempts', async () => {
  const developer = await User.create({
    name: 'Dev',
    email: `dev-matrix-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-long-enough-password',
    status: 'active',
    role: ROLE_IDS.DEVELOPER,
    roles: [ROLE_IDS.DEVELOPER],
  });

  await request(app())
    .put('/v1/rbac/role-matrix')
    .set('Authorization', bearer(developer))
    .send({ grants: { [ROLE_IDS.DEVELOPER]: ['users.manage', 'access.grant'] } })
    .expect(403);
});

test('POST /v1/rbac/users/:userId/scoped-assignments rejects unknown body keys', async () => {
  const admin = await makeAdmin();
  const developer = await User.create({
    name: 'Dev',
    email: `dev-unknown-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-long-enough-password',
    status: 'active',
    role: ROLE_IDS.DEVELOPER,
    roles: [ROLE_IDS.DEVELOPER],
  });
  const { client, project } = await seedScope(admin);

  const res = await request(app())
    .post(`/v1/rbac/users/${developer._id}/scoped-assignments`)
    .set('Authorization', bearer(admin))
    .send({
      role: ROLE_IDS.DEVELOPER,
      clientId: client._id,
      projectId: project._id,
      environments: ['Staging'],
      reason: 'Delivery',
      isSuperAdmin: true,
    })
    .expect(400);

  assert.ok(res.body.error.fields.isSuperAdmin);
});

test('PATCH /v1/rbac/scoped-assignments/:id rejects stale ifMatch with conflict', async () => {
  const admin = await makeAdmin();
  const developer = await User.create({
    name: 'Dev',
    email: `dev-stale-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-long-enough-password',
    status: 'active',
    role: ROLE_IDS.DEVELOPER,
    roles: [ROLE_IDS.DEVELOPER],
  });
  const { client, project } = await seedScope(admin);

  const created = await request(app())
    .post(`/v1/rbac/users/${developer._id}/scoped-assignments`)
    .set('Authorization', bearer(admin))
    .send({
      role: ROLE_IDS.DEVELOPER,
      clientId: client._id,
      projectId: project._id,
      environments: ['Staging'],
      reason: 'Initial grant',
    })
    .expect(201);

  await request(app())
    .patch(`/v1/rbac/scoped-assignments/${created.body.id}`)
    .set('Authorization', bearer(admin))
    .send({
      environments: ['Production'],
      reason: 'Production support',
      ifMatch: new Date(Date.now() - 60_000).toISOString(),
    })
    .expect(409);
});

test('project admin cannot create scoped assignment outside their coverage', async () => {
  const admin = await makeAdmin();
  const projectAdmin = await User.create({
    name: 'PA',
    email: `pa-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-long-enough-password',
    status: 'active',
    role: ROLE_IDS.PROJECT_ADMIN,
    roles: [ROLE_IDS.PROJECT_ADMIN],
  });
  const developer = await User.create({
    name: 'Dev',
    email: `dev-cross-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-long-enough-password',
    status: 'active',
    role: ROLE_IDS.DEVELOPER,
    roles: [ROLE_IDS.DEVELOPER],
  });
  const scopeA = await seedScope(admin);
  const scopeB = await seedScope(admin);

  await request(app())
    .post(`/v1/rbac/users/${projectAdmin._id}/scoped-assignments`)
    .set('Authorization', bearer(admin))
    .send({
      role: ROLE_IDS.PROJECT_ADMIN,
      clientId: scopeA.client._id,
      projectId: scopeA.project._id,
      environments: ['Staging'],
      reason: 'Scoped admin',
    })
    .expect(201);

  await request(app())
    .post(`/v1/rbac/users/${developer._id}/scoped-assignments`)
    .set('Authorization', bearer(projectAdmin))
    .send({
      role: ROLE_IDS.DEVELOPER,
      clientId: scopeB.client._id,
      projectId: scopeB.project._id,
      environments: ['Staging'],
      reason: 'Cross-scope grant',
    })
    .expect(403);
});

test('POST scoped assignment rejects super_admin role escalation', async () => {
  const admin = await makeAdmin();
  const developer = await User.create({
    name: 'Dev2',
    email: `dev-escalate-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-long-enough-password',
    status: 'active',
    role: ROLE_IDS.DEVELOPER,
    roles: [ROLE_IDS.DEVELOPER],
  });
  const { client, project } = await seedScope(admin);

  const res = await request(app())
    .post(`/v1/rbac/users/${developer._id}/scoped-assignments`)
    .set('Authorization', bearer(admin))
    .send({
      role: ROLE_IDS.SUPER_ADMIN,
      clientId: client._id,
      projectId: project._id,
      environments: ['Staging'],
      reason: 'Escalation attempt',
    })
    .expect(400);

  assert.ok(res.body.error.fields.role);
});
