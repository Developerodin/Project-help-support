import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS, mergeRoleMatrixWithBaseline } from '@pms/shared';
import request from 'supertest';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import Client from '../../clients/client.model.js';
import AccessAssignment from '../../access/accessAssignment.model.js';
import Ticket from '../ticket.model.js';
import { createApp } from '../../../app.js';
import { generateAccessToken } from '../../auth/token.service.js';
import {
  listTickets, getTicket, patchTicket, deleteTicket, assertCanEditTicket,
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

async function createUser(role) {
  return User.create({
    name: `${role} user`,
    email: `${role}-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-long-enough-password',
    status: 'active',
    role,
    roles: [role],
  });
}

function ctxFor(_role, extra = {}) {
  return {
    roleMatrix: null,
    userOverrides: extra.overrides || {},
    scopedAssignments: [],
  };
}

function clientViewCtx(permissions) {
  return {
    roleMatrix: mergeRoleMatrixWithBaseline({
      [ROLE_IDS.CLIENT]: { add: permissions },
      [ROLE_IDS.CLIENT_TESTER]: { add: permissions },
    }),
    userOverrides: {},
    scopedAssignments: [],
  };
}

async function seedInternalTicket(actorRole = ROLE_IDS.DEVELOPER) {
  const actor = await createUser(actorRole);
  const project = await Project.create({
    key: 'WEB', name: 'Web App', status: 'active', createdBy: actor._id,
  });
  const ticket = await Ticket.create({
    ticketId: 'WEB-1',
    project: project._id,
    title: 'Broken login',
    createdBy: actor._id,
    status: 'pending',
    severity: 'Minor',
    priority: 'Low',
  });
  return { actor, project, ticket };
}

async function seedExternalWorkspace() {
  const admin = await createUser(ROLE_IDS.ADMIN);
  const clientUser = await createUser(ROLE_IDS.CLIENT_TESTER);
  const company = await Client.create({ name: 'Acme', status: 'active', createdBy: admin._id });
  const projectA = await Project.create({
    key: 'AAA', name: 'Portal A', client: company._id, status: 'active', createdBy: admin._id,
  });
  const projectB = await Project.create({
    key: 'BBB', name: 'Portal B', client: company._id, status: 'active', createdBy: admin._id,
  });
  await AccessAssignment.create({
    user: clientUser._id,
    role: ROLE_IDS.CLIENT_TESTER,
    client: company._id,
    project: projectA._id,
    grantedBy: admin._id,
  });
  const inA = await Ticket.create({
    ticketId: 'AAA-1',
    project: projectA._id,
    title: 'In assigned project',
    createdBy: admin._id,
    status: 'pending',
    severity: 'Minor',
    priority: 'Low',
  });
  const inB = await Ticket.create({
    ticketId: 'BBB-1',
    project: projectB._id,
    title: 'In other project',
    createdBy: admin._id,
    status: 'pending',
    severity: 'Minor',
    priority: 'Low',
  });
  return { admin, clientUser, projectA, projectB, inA, inB };
}

test('A internal VIEW only: lists own tickets, cannot edit or delete', async () => {
  const { actor, ticket } = await seedInternalTicket(ROLE_IDS.READ_ONLY);
  const ctx = ctxFor(ROLE_IDS.READ_ONLY);

  const page = await listTickets(actor, {}, ctx);
  assert.equal(page.results[0].ticketId, 'WEB-1');
  assert.equal((await getTicket(actor, 'WEB-1', ctx)).ticketId, 'WEB-1');

  const doc = await Ticket.findById(ticket._id);
  await assert.rejects(
    () => assertCanEditTicket(actor, doc, ctx),
    (err) => err.statusCode === 403,
  );
  await assert.rejects(
    () => deleteTicket('WEB-1', actor, ctx),
    (err) => err.statusCode === 403,
  );
});

test('B internal VIEW+EDIT: edit works, delete hidden by API', async () => {
  const { actor } = await seedInternalTicket(ROLE_IDS.DEVELOPER);
  const ctx = ctxFor(ROLE_IDS.DEVELOPER);

  const updated = await patchTicket(actor, 'WEB-1', { revision: 0, priority: 'Urgent' }, ctx);
  assert.equal(updated.priority, 'Urgent');
  await assert.rejects(
    () => deleteTicket('WEB-1', actor, ctx),
    (err) => err.statusCode === 403,
  );
});

test('C internal VIEW+DELETE: delete works, edit rejected', async () => {
  const { actor } = await seedInternalTicket(ROLE_IDS.READ_ONLY);
  const ctx = ctxFor(ROLE_IDS.READ_ONLY, { overrides: { 'tickets.delete': 'allow' } });

  const doc = await Ticket.findById((await Ticket.findOne({ ticketId: 'WEB-1' }))._id);
  await assert.rejects(
    () => assertCanEditTicket(actor, doc, ctx),
    (err) => err.statusCode === 403,
  );
  const removed = await deleteTicket('WEB-1', actor, ctx);
  assert.equal(removed.ticketId, 'WEB-1');
});

test('D internal VIEW+EDIT+DELETE: full access on owned ticket', async () => {
  const { actor } = await seedInternalTicket(ROLE_IDS.DEVELOPER);
  const ctx = ctxFor(ROLE_IDS.DEVELOPER, { overrides: { 'tickets.delete': 'allow' } });

  const updated = await patchTicket(actor, 'WEB-1', { revision: 0, priority: 'Low' }, ctx);
  assert.equal(updated.priority, 'Low');
  const removed = await deleteTicket('WEB-1', actor, ctx);
  assert.equal(removed.ticketId, 'WEB-1');
});

test('E external AccessAssignment scope: assigned-project tickets only, no edit/delete without grants', async () => {
  const { clientUser, inA } = await seedExternalWorkspace();
  const ctx = clientViewCtx([]);

  const page = await listTickets(clientUser, {}, ctx);
  assert.deepEqual(page.results.map((t) => t.ticketId).sort(), ['AAA-1']);
  assert.equal((await getTicket(clientUser, inA.ticketId, ctx)).ticketId, 'AAA-1');
  await assert.rejects(
    () => getTicket(clientUser, 'BBB-1', ctx),
    (err) => err.statusCode === 403,
  );

  const doc = await Ticket.findById(inA._id);
  await assert.rejects(
    () => assertCanEditTicket(clientUser, doc, ctx),
    (err) => err.statusCode === 403,
  );
  await assert.rejects(
    () => deleteTicket('AAA-1', clientUser, ctx),
    (err) => err.statusCode === 403,
  );
});

test('F external VIEW+EDIT: can patch assigned-project tickets only', async () => {
  const { clientUser } = await seedExternalWorkspace();
  const ctx = clientViewCtx(['tickets.view', 'tickets.edit']);

  const updated = await patchTicket(clientUser, 'AAA-1', { revision: 0, priority: 'Urgent' }, ctx);
  assert.equal(updated.priority, 'Urgent');
  await assert.rejects(
    () => patchTicket(clientUser, 'BBB-1', { revision: 0, priority: 'Low' }, ctx),
    (err) => err.statusCode === 403,
  );
});

test('G external VIEW+DELETE: delete only in assigned project scope', async () => {
  const { clientUser } = await seedExternalWorkspace();
  const ctx = clientViewCtx(['tickets.view', 'tickets.delete']);

  await assert.rejects(
    () => deleteTicket('BBB-1', clientUser, ctx),
    (err) => err.statusCode === 403,
  );
  const removed = await deleteTicket('AAA-1', clientUser, ctx);
  assert.equal(removed.ticketId, 'AAA-1');
});

test('H no VIEW: list and detail rejected', async () => {
  const actor = await createUser(ROLE_IDS.UNASSIGNED);
  const ctx = ctxFor(ROLE_IDS.UNASSIGNED);
  await assert.rejects(
    () => listTickets(actor, {}, ctx),
    (err) => err.statusCode === 403,
  );
});

test('I VIEW no EDIT: direct edit API rejected', async () => {
  const { user, project } = await (async () => {
    const reporter = await createUser(ROLE_IDS.DEVELOPER);
    const project = await Project.create({
      key: 'WEB', name: 'Web App', status: 'active', createdBy: reporter._id,
    });
    await Ticket.create({
      ticketId: 'WEB-1',
      project: project._id,
      title: 'Broken login',
      createdBy: reporter._id,
      status: 'pending',
    });
    return { user: reporter, project };
  })();
  void project;

  const res = await request(app())
    .patch('/v1/tickets/WEB-1')
    .set('Authorization', bearer(await createUser(ROLE_IDS.READ_ONLY)))
    .send({ revision: 0, priority: 'Urgent' })
    .expect(403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
  void user;
});

test('J VIEW no DELETE: direct delete API rejected', async () => {
  const reporter = await createUser(ROLE_IDS.DEVELOPER);
  const project = await Project.create({
    key: 'WEB', name: 'Web App', status: 'active', createdBy: reporter._id,
  });
  await Ticket.create({
    ticketId: 'WEB-1',
    project: project._id,
    title: 'Broken login',
    createdBy: reporter._id,
    status: 'pending',
  });

  const res = await request(app())
    .delete('/v1/tickets/WEB-1')
    .set('Authorization', bearer(reporter))
    .expect(403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('K/L external assigned project A only, not B; multiple assignments visible', async () => {
  const { admin, clientUser, projectB } = await seedExternalWorkspace();
  const ctx = clientViewCtx(['tickets.view']);

  let page = await listTickets(clientUser, {}, ctx);
  assert.deepEqual(page.results.map((t) => t.ticketId), ['AAA-1']);

  await AccessAssignment.create({
    user: clientUser._id,
    role: ROLE_IDS.CLIENT_TESTER,
    client: (await Project.findById(projectB._id)).client,
    project: projectB._id,
    grantedBy: admin._id,
  });

  page = await listTickets(clientUser, {}, ctx);
  assert.deepEqual(page.results.map((t) => t.ticketId).sort(), ['AAA-1', 'BBB-1']);
});

test('API bypass: no VIEW is denied on list and detail', async () => {
  const reporter = await createUser(ROLE_IDS.DEVELOPER);
  const project = await Project.create({
    key: 'WEB', name: 'Web App', status: 'active', createdBy: reporter._id,
  });
  await Ticket.create({
    ticketId: 'WEB-1',
    project: project._id,
    title: 'Broken login',
    createdBy: reporter._id,
    status: 'pending',
  });
  const none = await createUser(ROLE_IDS.UNASSIGNED);

  const list = await request(app())
    .get('/v1/tickets')
    .set('Authorization', bearer(none))
    .expect(403);
  assert.equal(list.body.error.code, 'FORBIDDEN');

  const detail = await request(app())
    .get('/v1/tickets/WEB-1')
    .set('Authorization', bearer(none))
    .expect(403);
  assert.equal(detail.body.error.code, 'FORBIDDEN');
});

test('generic DELETE cannot remove another project ticket the actor cannot access', async () => {
  const owner = await createUser(ROLE_IDS.DEVELOPER);
  const other = await createUser(ROLE_IDS.DEVELOPER);
  const web = await Project.create({
    key: 'WEB', name: 'Web App', status: 'active', createdBy: owner._id,
  });
  await Ticket.create({
    ticketId: 'WEB-9',
    project: web._id,
    title: 'Owner only',
    createdBy: owner._id,
    status: 'pending',
  });
  const ctx = ctxFor(ROLE_IDS.DEVELOPER, { overrides: { 'tickets.delete': 'allow' } });

  await assert.rejects(
    () => deleteTicket('WEB-9', other, ctx),
    (err) => err.statusCode === 403,
  );
});
