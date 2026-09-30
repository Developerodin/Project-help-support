import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS, boardPolicyToRecord } from '@pms/shared';
import request from 'supertest';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import Client from '../../clients/client.model.js';
import AccessAssignment from '../../access/accessAssignment.model.js';
import BoardRoleMatrix from '../../rbac/boardRoleMatrix.model.js';
import RoleMatrix from '../../rbac/roleMatrix.model.js';
import { getCodeBaselineBoardPolicy } from '../../rbac/rbac.service.js';
import Ticket from '../ticket.model.js';
import { createApp } from '../../../app.js';
import { generateAccessToken } from '../../auth/token.service.js';
import { createTicket } from '../ticket.service.js';
import { transitionTicket } from '../transition.service.js';

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
const IN_A_WEEK = new Date(Date.now() + 7 * 86400000);

function permCtx(role, permissions) {
  return { roleMatrix: { [role]: permissions }, userOverrides: {}, scopedAssignments: [] };
}

function externalAcceptCtx(role) {
  return permCtx(role, ['tickets.view', 'tickets.accept']);
}

async function persistBoardPolicy(mutator, adminId) {
  const record = boardPolicyToRecord(getCodeBaselineBoardPolicy());
  mutator(record);
  const grantsMap = new Map();
  for (const [role, boards] of Object.entries(record)) {
    grantsMap.set(role, new Map(Object.entries(boards)));
  }
  await BoardRoleMatrix.findOneAndUpdate(
    { key: 'active' },
    { $set: { grants: grantsMap, updatedBy: adminId }, $setOnInsert: { key: 'active' } },
    { upsert: true },
  );
}

async function persistRoleMatrix(role, permissions, adminId) {
  const grantsMap = new Map();
  grantsMap.set(role, permissions);
  await RoleMatrix.findOneAndUpdate(
    { key: 'active' },
    { $set: { grants: grantsMap, updatedBy: adminId }, $setOnInsert: { key: 'active' } },
    { upsert: true },
  );
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

async function seedQaTicket() {
  const admin = await createUser({
    email: `admin-${Math.random().toString(36).slice(2)}@example.com`,
    roles: [ROLE_IDS.ADMIN],
  });
  const tester = await createUser({
    email: `tester-${Math.random().toString(36).slice(2)}@example.com`,
    roles: [ROLE_IDS.TESTER],
  });
  const project = await Project.create({
    key: 'WEB', name: 'Web App', status: 'active', createdBy: admin._id,
  });
  const ticket = await createTicket(admin, {
    project: project.id,
    title: 'QA lane ticket',
    description: 'Ready for QA testing on staging.',
    assignedTo: String(admin._id),
    testedBy: String(tester._id),
  });
  await Ticket.updateOne({ _id: ticket.id }, {
    $set: {
      status: 'ready_qa',
      estimatedResolutionAt: IN_A_WEEK,
      expectedReleaseDate: IN_A_WEEK,
    },
  });
  return { admin, tester, ticket };
}

async function seedDevTicket() {
  const admin = await createUser({
    email: `admin-${Math.random().toString(36).slice(2)}@example.com`,
    roles: [ROLE_IDS.ADMIN],
  });
  const developer = await createUser({
    email: `dev-${Math.random().toString(36).slice(2)}@example.com`,
    roles: [ROLE_IDS.DEVELOPER],
  });
  const project = await Project.create({
    key: 'DEV', name: 'Dev lane', status: 'active', createdBy: admin._id,
  });
  const ticket = await createTicket(admin, {
    project: project.id,
    title: 'Cross-lane dev ticket',
    description: 'Ready to hand off to QA.',
    assignedTo: String(developer._id),
  });
  await Ticket.updateOne({ _id: ticket.id }, {
    $set: {
      status: 'in_progress',
      estimatedResolutionAt: IN_A_WEEK,
      expectedReleaseDate: IN_A_WEEK,
    },
  });
  return { admin, developer, ticket };
}

async function seedExternalLiveTicket(role = ROLE_IDS.CLIENT) {
  const admin = await createUser({
    email: `admin-${Math.random().toString(36).slice(2)}@example.com`,
    roles: [ROLE_IDS.ADMIN],
  });
  const externalUser = await createUser({
    email: `ext-${Math.random().toString(36).slice(2)}@example.com`,
    roles: [role],
  });
  const company = await Client.create({
    name: `Co-${Math.random().toString(36).slice(2)}`, status: 'active', createdBy: admin._id,
  });
  const project = await Project.create({
    key: `EX${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    name: 'External', client: company._id, createdBy: admin._id, status: 'active',
  });
  await AccessAssignment.create({
    user: externalUser._id, role,
    client: company._id, project: project._id, status: 'active', grantedBy: admin._id,
  });
  const ticket = await createTicket(admin, {
    project: project.id, title: 'External live ticket', assignedTo: String(admin._id),
  });
  await Ticket.updateOne({ _id: ticket.id }, {
    $set: {
      createdBy: externalUser._id,
      estimatedResolutionAt: IN_A_WEEK,
      expectedReleaseDate: IN_A_WEEK,
    },
  });
  const live = await transitionTicket(admin, ticket.ticketId, { to: 'live', revision: ticket.revision });
  return { admin, externalUser, ticket: live.ticket };
}

test('tester with QA lane permission can transition QA ticket without tickets.edit', async () => {
  const { tester, ticket } = await seedQaTicket();

  const moved = await transitionTicket(tester, ticket.ticketId, {
    to: 'deployed_staging',
    revision: 0,
  });
  assert.equal(moved.ticket.status, 'deployed_staging');
});

test('tester with QA lane only cannot transition development ticket', async () => {
  const { admin, tester } = await seedQaTicket();
  const project = await Project.findOne();
  const devTicket = await createTicket(admin, {
    project: project.id,
    title: 'Dev lane ticket',
    description: 'Still in development.',
    assignedTo: String(admin._id),
    testedBy: String(tester._id),
  });
  await Ticket.updateOne({ _id: devTicket.id }, {
    $set: {
      status: 'in_progress',
      estimatedResolutionAt: IN_A_WEEK,
      expectedReleaseDate: IN_A_WEEK,
    },
  });

  await assert.rejects(
    () => transitionTicket(tester, devTicket.ticketId, { to: 'ready_qa', revision: 0 }),
    (err) => err.statusCode === 400 && err.code === 'STAGE_NOT_PERMITTED',
  );
});

test('user with tickets.edit but no lane permission is blocked on transition API', async () => {
  const admin = await createUser({
    email: `admin-${Math.random().toString(36).slice(2)}@example.com`,
    roles: [ROLE_IDS.ADMIN],
  });
  const editor = await createUser({
    email: `editor-${Math.random().toString(36).slice(2)}@example.com`,
    roles: [ROLE_IDS.READ_ONLY],
  });
  const project = await Project.create({
    key: 'EDT', name: 'Edit only', status: 'active', createdBy: admin._id,
  });
  const ticket = await createTicket(admin, {
    project: project.id,
    title: 'No board caps',
    description: 'Reporter has edit but no lane capabilities.',
    assignedTo: String(admin._id),
  });
  await Ticket.updateOne({ _id: ticket.id }, {
    $set: {
      createdBy: editor._id,
      estimatedResolutionAt: IN_A_WEEK,
      expectedReleaseDate: IN_A_WEEK,
    },
  });

  const permCtx = {
    roleMatrix: { [ROLE_IDS.READ_ONLY]: ['tickets.view', 'tickets.edit'] },
    userOverrides: {},
    scopedAssignments: [],
  };

  await assert.rejects(
    () => transitionTicket(editor, ticket.ticketId, { to: 'in_progress', revision: 0 }, permCtx),
    (err) => err.statusCode === 400 && err.code === 'STAGE_NOT_PERMITTED',
  );
});

test('transition route blocks unrelated user without ticket visibility', async () => {
  const { ticket } = await seedQaTicket();
  const stranger = await createUser({
    email: `stranger-${Math.random().toString(36).slice(2)}@example.com`,
    roles: [ROLE_IDS.DEVELOPER],
  });

  const res = await request(app())
    .post(`/v1/tickets/${ticket.ticketId}/transition`)
    .set('Authorization', bearer(stranger))
    .send({ to: 'deployed_staging', revision: 0 })
    .expect(403);

  assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('internal user with view only and no lane capability cannot transition', async () => {
  const admin = await createUser({
    email: `admin-${Math.random().toString(36).slice(2)}@example.com`,
    roles: [ROLE_IDS.ADMIN],
  });
  const viewer = await createUser({
    email: `viewer-${Math.random().toString(36).slice(2)}@example.com`,
    roles: [ROLE_IDS.READ_ONLY],
  });
  const project = await Project.create({
    key: 'VW', name: 'View only', status: 'active', createdBy: admin._id,
  });
  const ticket = await createTicket(admin, {
    project: project.id,
    title: 'Reporter can view only',
    description: 'No board capabilities configured.',
    assignedTo: String(admin._id),
  });
  await Ticket.updateOne({ _id: ticket.id }, {
    $set: {
      createdBy: viewer._id,
      estimatedResolutionAt: IN_A_WEEK,
      expectedReleaseDate: IN_A_WEEK,
    },
  });

  await assert.rejects(
    () => transitionTicket(
      viewer,
      ticket.ticketId,
      { to: 'in_progress', revision: 0 },
      permCtx(ROLE_IDS.READ_ONLY, ['tickets.view']),
    ),
    (err) => err.statusCode === 400 && err.code === 'STAGE_NOT_PERMITTED',
  );
});

test('developer with dev transition and QA operate can move in_progress to ready_qa', async () => {
  const { developer, ticket } = await seedDevTicket();

  const moved = await transitionTicket(developer, ticket.ticketId, {
    to: 'ready_qa',
    revision: 0,
  });
  assert.equal(moved.ticket.status, 'ready_qa');
});

test('developer with dev transition only cannot cross into QA lane', async () => {
  const { admin, developer, ticket } = await seedDevTicket();

  await persistBoardPolicy((record) => {
    record[ROLE_IDS.DEVELOPER] = {
      intake: [],
      development: ['transition'],
      qa: [],
      release: [],
      done: [],
    };
  }, admin._id);

  await assert.rejects(
    () => transitionTicket(developer, ticket.ticketId, { to: 'ready_qa', revision: 0 }),
    (err) => err.statusCode === 400 && err.code === 'STAGE_NOT_PERMITTED',
  );
});

test('mixed developer+client role uses internal lane policy for development moves', async () => {
  const admin = await createUser({
    email: `admin-${Math.random().toString(36).slice(2)}@example.com`,
    roles: [ROLE_IDS.ADMIN],
  });
  const hybrid = await createUser({
    email: `hybrid-${Math.random().toString(36).slice(2)}@example.com`,
    roles: [ROLE_IDS.DEVELOPER, ROLE_IDS.CLIENT],
  });
  const project = await Project.create({
    key: 'MIX', name: 'Mixed role project', status: 'active', createdBy: admin._id,
  });
  const ticket = await createTicket(admin, {
    project: project.id,
    title: 'Mixed role ticket',
    description: 'Hybrid users should follow internal board caps when present.',
    assignedTo: String(hybrid._id),
  });
  await Ticket.updateOne({ _id: ticket.id }, {
    $set: {
      status: 'in_progress',
      estimatedResolutionAt: IN_A_WEEK,
      expectedReleaseDate: IN_A_WEEK,
    },
  });

  const moved = await transitionTicket(hybrid, ticket.ticketId, {
    to: 'ready_qa',
    revision: 0,
  });
  assert.equal(moved.ticket.status, 'ready_qa');
});

test('transition route blocks user with tickets.edit but no ticket visibility', async () => {
  const { ticket } = await seedQaTicket();
  const editor = await createUser({
    email: `editor-${Math.random().toString(36).slice(2)}@example.com`,
    roles: [ROLE_IDS.DEVELOPER],
  });

  const res = await request(app())
    .post(`/v1/tickets/${ticket.ticketId}/transition`)
    .set('Authorization', bearer(editor))
    .send({ to: 'deployed_staging', revision: 0 })
    .expect(403);

  assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('external user with tickets.accept can only close live or reopen closed tickets', async () => {
  const { externalUser, ticket } = await seedExternalLiveTicket(ROLE_IDS.CLIENT);
  const ctx = externalAcceptCtx(ROLE_IDS.CLIENT);

  const closed = await transitionTicket(externalUser, ticket.ticketId, {
    to: 'closed', revision: ticket.revision, reason: 'Accepted',
  }, ctx);
  assert.equal(closed.ticket.status, 'closed');

  await assert.rejects(
    () => transitionTicket(externalUser, ticket.ticketId, {
      to: 'ready_production', revision: closed.ticket.revision,
    }, ctx),
    (err) => err.statusCode === 403 && err.code === 'FORBIDDEN',
  );
});

test('external transition route rejects close without tickets.accept', async () => {
  const { admin, externalUser, ticket } = await seedExternalLiveTicket(ROLE_IDS.CLIENT_TESTER);
  await persistRoleMatrix(ROLE_IDS.CLIENT_TESTER, ['tickets.view'], admin._id);

  const res = await request(app())
    .post(`/v1/tickets/${ticket.ticketId}/transition`)
    .set('Authorization', bearer(externalUser))
    .send({ to: 'closed', revision: ticket.revision, reason: 'No accept perm' })
    .expect(403);

  assert.equal(res.body.error.code, 'FORBIDDEN');
  assert.match(res.body.error.message, /cannot close or reopen/i);
});
