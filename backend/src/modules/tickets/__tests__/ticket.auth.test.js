import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS } from '@pms/shared';
import request from 'supertest';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import Client from '../../clients/client.model.js';
import AccessAssignment from '../../access/accessAssignment.model.js';
import Ticket from '../ticket.model.js';
import { createApp } from '../../../app.js';
import { generateAccessToken } from '../../auth/token.service.js';
import { updateRoleMatrix } from '../../rbac/rbac.service.js';
import {
  listTickets, getTicket, createTicket, patchTicket, deleteTicket,
} from '../ticket.service.js';

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

function permCtx(role, permissions) {
  return { roleMatrix: { [role]: permissions }, userOverrides: {}, scopedAssignments: [] };
}

async function createUser({ email, roles }) {
  return User.create({
    name: email.split('@')[0],
    email,
    password: 'a-long-enough-password',
    status: 'active',
    role: roles[0],
    roles,
  });
}

const createBody = (projectId, title = 'Broken login button') => ({
  project: String(projectId),
  title,
  description: 'Expected login to succeed but the button does nothing when clicked.',
});

async function seedInternalTicket(role = ROLE_IDS.DEVELOPER) {
  const actor = await createUser({
    email: `${role}-${Math.random().toString(36).slice(2)}@example.com`,
    roles: [role],
  });
  const project = await Project.create({
    key: 'WEB', name: 'Web App', status: 'active', createdBy: actor._id,
  });
  const canFile = [
    ROLE_IDS.DEVELOPER, ROLE_IDS.ADMIN, ROLE_IDS.PROJECT_ADMIN, ROLE_IDS.TESTER, ROLE_IDS.SUPPORT,
  ].includes(role);
  const filer = canFile ? actor : await createUser({
    email: `filer-${Math.random().toString(36).slice(2)}@example.com`,
    roles: [ROLE_IDS.DEVELOPER],
  });
  const ticket = await createTicket(filer, {
    project: project.id, title: 'Broken login', description: 'Button does nothing on click.',
  });
  if (String(filer._id) !== String(actor._id)) {
    await Ticket.updateOne({ ticketId: ticket.ticketId }, { createdBy: actor._id });
  }
  return { actor, project, ticket };
}

async function seedExternal({ permissions = ['tickets.view'] } = {}) {
  const admin = await createUser({
    email: `admin-${Math.random().toString(36).slice(2)}@example.com`,
    roles: [ROLE_IDS.ADMIN],
  });
  const clientUser = await createUser({
    email: `tester-${Math.random().toString(36).slice(2)}@example.com`,
    roles: [ROLE_IDS.CLIENT_TESTER],
  });
  const company = await Client.create({ name: 'Acme', status: 'active', createdBy: admin._id });
  const projectA = await Project.create({
    key: 'ACA', name: 'Portal A', client: company._id, status: 'active', createdBy: admin._id,
  });
  const projectB = await Project.create({
    key: 'ACB', name: 'Portal B', client: company._id, status: 'active', createdBy: admin._id,
  });
  await AccessAssignment.create({
    user: clientUser._id,
    role: ROLE_IDS.CLIENT_TESTER,
    client: company._id,
    project: projectA._id,
    grantedBy: admin._id,
  });

  await updateRoleMatrix(admin, {
    grants: { [ROLE_IDS.CLIENT_TESTER]: permissions },
  });

  const ticketA = await Ticket.create({
    ticketId: `ACA-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    project: projectA._id, title: 'A defect',
    createdBy: admin._id, status: 'pending', severity: 'Minor', priority: 'Low',
  });
  const ticketB = await Ticket.create({
    ticketId: `ACB-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    project: projectB._id, title: 'B defect',
    createdBy: admin._id, status: 'pending', severity: 'Minor', priority: 'Low',
  });
  await Project.updateOne({ _id: projectA._id }, { $set: { nextTicketSeq: 100 } });

  return { admin, clientUser, projectA, projectB, ticketA, ticketB };
}

test('VIEW is required: unassigned cannot list or get tickets', async () => {
  const { ticket } = await seedInternalTicket();
  const outsider = await createUser({
    email: `none-${Math.random().toString(36).slice(2)}@example.com`,
    roles: [ROLE_IDS.UNASSIGNED],
  });

  await assert.rejects(
    () => listTickets(outsider, {}),
    (err) => err.statusCode === 403 && /tickets\.view/.test(err.message),
  );
  await assert.rejects(
    () => getTicket(outsider, ticket.ticketId),
    (err) => err.statusCode === 403 && /tickets\.view/.test(err.message),
  );

  const res = await request(app())
    .get('/v1/tickets')
    .set('Authorization', bearer(outsider))
    .expect(403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('VIEW does not grant CREATE, EDIT, or DELETE', async () => {
  const { actor, project, ticket } = await seedInternalTicket(ROLE_IDS.READ_ONLY);

  await assert.rejects(
    () => createTicket(actor, {
      project: project.id, title: 'New issue', description: 'Should not be created here.',
    }),
    (err) => err.statusCode === 403 && /tickets\.create/.test(err.message),
  );
  await assert.rejects(
    () => patchTicket(actor, ticket.ticketId, { revision: 0, priority: 'Urgent' }),
    (err) => err.statusCode === 403 && /tickets\.edit/.test(err.message),
  );
  await assert.rejects(
    () => deleteTicket(ticket.ticketId, actor),
    (err) => err.statusCode === 403 && /tickets\.delete/.test(err.message),
  );

  await request(app())
    .post('/v1/tickets')
    .set('Authorization', bearer(actor))
    .send(createBody(project._id))
    .expect(403);
  await request(app())
    .patch(`/v1/tickets/${ticket.ticketId}`)
    .set('Authorization', bearer(actor))
    .send({ revision: 0, priority: 'Urgent' })
    .expect(403);
  await request(app())
    .delete(`/v1/tickets/${ticket.ticketId}`)
    .set('Authorization', bearer(actor))
    .expect(403);
});

test('internal VIEW lists only related tickets, not every project ticket', async () => {
  const { actor, ticket } = await seedInternalTicket();
  const other = await createUser({
    email: `dev-${Math.random().toString(36).slice(2)}@example.com`,
    roles: [ROLE_IDS.DEVELOPER],
  });

  const page = await listTickets(other, {});
  assert.equal(page.totalResults, 0);
  await assert.rejects(() => getTicket(other, ticket.ticketId), (err) => err.statusCode === 403);

  const res = await request(app())
    .get(`/v1/tickets/${ticket.ticketId}`)
    .set('Authorization', bearer(other))
    .expect(403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('VIEW+CREATE allows create but not edit or delete', async () => {
  const { actor, project, ticket } = await seedInternalTicket(ROLE_IDS.READ_ONLY);
  const ctx = permCtx(ROLE_IDS.READ_ONLY, ['tickets.view', 'tickets.create']);

  const created = await createTicket(actor, {
    project: project.id, title: 'Filed by viewer', description: 'Has create but not edit.',
  }, ctx);
  assert.ok(created.ticketId);

  await assert.rejects(
    () => patchTicket(actor, ticket.ticketId, { revision: 0, priority: 'Urgent' }, ctx),
    (err) => err.statusCode === 403 && /tickets\.edit/.test(err.message),
  );
  await assert.rejects(
    () => deleteTicket(ticket.ticketId, actor, ctx),
    (err) => err.statusCode === 403 && /tickets\.delete/.test(err.message),
  );
});

test('VIEW+EDIT allows edit but not create or delete', async () => {
  const { actor, project, ticket } = await seedInternalTicket(ROLE_IDS.READ_ONLY);
  const ctx = permCtx(ROLE_IDS.READ_ONLY, ['tickets.view', 'tickets.edit']);

  const updated = await patchTicket(actor, ticket.ticketId, { revision: 0, priority: 'Urgent' }, ctx);
  assert.equal(updated.priority, 'Urgent');

  await assert.rejects(
    () => createTicket(actor, {
      project: project.id, title: 'Should fail', description: 'No create permission here.',
    }, ctx),
    (err) => err.statusCode === 403 && /tickets\.create/.test(err.message),
  );
  await assert.rejects(
    () => deleteTicket(ticket.ticketId, actor, ctx),
    (err) => err.statusCode === 403 && /tickets\.delete/.test(err.message),
  );
});

test('VIEW+DELETE allows delete of related tickets but not create or edit', async () => {
  const { actor, project, ticket } = await seedInternalTicket(ROLE_IDS.READ_ONLY);
  const ctx = permCtx(ROLE_IDS.READ_ONLY, ['tickets.view', 'tickets.delete']);

  await assert.rejects(
    () => createTicket(actor, {
      project: project.id, title: 'Should fail', description: 'No create permission here.',
    }, ctx),
    (err) => err.statusCode === 403 && /tickets\.create/.test(err.message),
  );
  await assert.rejects(
    () => patchTicket(actor, ticket.ticketId, { revision: 0, priority: 'Urgent' }, ctx),
    (err) => err.statusCode === 403 && /tickets\.edit/.test(err.message),
  );

  const removed = await deleteTicket(ticket.ticketId, actor, ctx);
  assert.equal(removed.ticketId, ticket.ticketId);
});

test('DELETE cannot remove an unrelated project ticket', async () => {
  const { ticket } = await seedInternalTicket();
  const other = await createUser({
    email: `adminish-${Math.random().toString(36).slice(2)}@example.com`,
    roles: [ROLE_IDS.DEVELOPER],
  });
  const ctx = permCtx(ROLE_IDS.DEVELOPER, [
    'tickets.view', 'tickets.create', 'tickets.edit', 'tickets.delete',
  ]);

  await assert.rejects(
    () => deleteTicket(ticket.ticketId, other, ctx),
    (err) => err.statusCode === 403,
  );

  const res = await request(app())
    .delete(`/v1/tickets/${ticket.ticketId}`)
    .set('Authorization', bearer(other))
    .expect(403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
  assert.equal(await Ticket.countDocuments({ ticketId: ticket.ticketId }), 1);
});

test('external lists assigned-project tickets without RBAC tickets.view', async () => {
  const { clientUser, ticketA, ticketB } = await seedExternal({ permissions: [] });

  const page = await listTickets(clientUser, {});
  assert.deepEqual(page.results.map((t) => t.ticketId).sort(), [ticketA.ticketId]);
  assert.equal((await getTicket(clientUser, ticketA.ticketId)).ticketId, ticketA.ticketId);
  await assert.rejects(() => getTicket(clientUser, ticketB.ticketId), (err) => err.statusCode === 403);

  const res = await request(app())
    .get('/v1/tickets')
    .set('Authorization', bearer(clientUser))
    .expect(200);
  assert.deepEqual(res.body.results.map((t) => t.ticketId).sort(), [ticketA.ticketId]);
});

test('external with VIEW sees all tickets on assigned projects only', async () => {
  const { clientUser, ticketA, ticketB } = await seedExternal({
    permissions: ['tickets.view'],
  });

  const page = await listTickets(clientUser, {});
  assert.deepEqual(page.results.map((t) => t.ticketId).sort(), [ticketA.ticketId]);
  assert.equal((await getTicket(clientUser, ticketA.ticketId)).ticketId, ticketA.ticketId);
  await assert.rejects(() => getTicket(clientUser, ticketB.ticketId), (err) => err.statusCode === 403);

  const listRes = await request(app())
    .get('/v1/tickets')
    .set('Authorization', bearer(clientUser))
    .expect(200);
  assert.deepEqual(listRes.body.results.map((t) => t.ticketId).sort(), [ticketA.ticketId]);

  await request(app())
    .get(`/v1/tickets/${ticketB.ticketId}`)
    .set('Authorization', bearer(clientUser))
    .expect(403);
});

test('external CREATE/EDIT/DELETE are independent of VIEW and scoped to assigned projects', async () => {
  const { clientUser, projectA, projectB, ticketA, ticketB } = await seedExternal({
    permissions: ['tickets.view', 'tickets.create', 'tickets.edit', 'tickets.delete'],
  });

  const created = await request(app())
    .post('/v1/tickets')
    .set('Authorization', bearer(clientUser))
    .send(createBody(projectA._id, 'Client filed this ticket'))
    .expect(201);
  assert.ok(created.body.ticketId);

  await request(app())
    .post('/v1/tickets')
    .set('Authorization', bearer(clientUser))
    .send(createBody(projectB._id, 'Other project should fail'))
    .expect(403);

  await request(app())
    .patch(`/v1/tickets/${ticketA.ticketId}`)
    .set('Authorization', bearer(clientUser))
    .send({ revision: 0, priority: 'Urgent' })
    .expect(200);

  await request(app())
    .patch(`/v1/tickets/${ticketB.ticketId}`)
    .set('Authorization', bearer(clientUser))
    .send({ revision: 0, priority: 'Urgent' })
    .expect(403);

  await request(app())
    .delete(`/v1/tickets/${ticketB.ticketId}`)
    .set('Authorization', bearer(clientUser))
    .expect(403);

  await request(app())
    .delete(`/v1/tickets/${ticketA.ticketId}`)
    .set('Authorization', bearer(clientUser))
    .expect(200);
});

test('swapped ticket ids cannot bypass project scope on delete', async () => {
  const { clientUser, ticketA, ticketB } = await seedExternal({
    permissions: ['tickets.view', 'tickets.delete'],
  });

  const res = await request(app())
    .delete(`/v1/tickets/${ticketB.ticketId}`)
    .set('Authorization', bearer(clientUser))
    .send({ id: ticketA.ticketId })
    .expect(403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
  assert.equal(await Ticket.countDocuments({ ticketId: ticketB.ticketId }), 1);
});
