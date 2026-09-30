import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS } from '@pms/shared';
import request from 'supertest';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import Ticket from '../ticket.model.js';
import { createApp } from '../../../app.js';
import { generateAccessToken } from '../../auth/token.service.js';
import { createTicket } from '../ticket.service.js';
import { addComment, editComment } from '../comment.service.js';
import { addAttachments, removeAttachment } from '../attachment.service.js';
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
  features: { attachments: true, email: false, seed: false },
  storage: { bucket: 'b', region: 'r' }, email: null, seed: null,
};

const app = () => createApp(config);
const bearer = (user) => `Bearer ${generateAccessToken(user, config)}`;

const attachmentStorage = {
  putObject: async () => {},
  deleteObject: async () => {},
  presignGet: async () => 'https://example.test/file',
};

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(16),
]);
const file = () => ({
  originalname: 'shot.png', buffer: png, size: png.length, mimetype: 'application/octet-stream',
});

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

async function seedReporterTicket(role = ROLE_IDS.READ_ONLY) {
  const actor = await createUser({
    email: `${role}-${Math.random().toString(36).slice(2)}@example.com`,
    roles: [role],
  });
  const filer = role === ROLE_IDS.READ_ONLY || role === ROLE_IDS.UNASSIGNED
    ? await createUser({
      email: `filer-${Math.random().toString(36).slice(2)}@example.com`,
      roles: [ROLE_IDS.DEVELOPER],
    })
    : actor;
  const project = await Project.create({
    key: 'WEB', name: 'Web App', status: 'active', createdBy: filer._id,
  });
  const ticket = await createTicket(filer, {
    project: project.id, title: 'Broken login', description: 'Button does nothing on click.',
  });
  await Ticket.updateOne({ _id: ticket.id }, { $set: { createdBy: actor._id } });
  return { actor, project, ticket };
}

test('VIEW only: can comment and upload attachment; cannot edit comment, delete attachment, or transition', async () => {
  const { actor, ticket } = await seedReporterTicket();
  const ctx = permCtx(ROLE_IDS.READ_ONLY, ['tickets.view']);

  const { comment } = await addComment(actor, ticket.ticketId, {
    content: 'Looks broken on Safari', clientRef: 'c1',
  }, ctx);
  assert.ok(comment.content);

  const uploaded = await addAttachments(actor, ticket.ticketId, [file()], config, {
    storage: attachmentStorage, permissionContext: ctx,
  });
  assert.equal(uploaded.attachments.length, 1);

  await assert.rejects(
    () => editComment(actor, ticket.ticketId, comment._id, { content: 'Changed' }, ctx),
    (err) => err.statusCode === 403 && /tickets\.edit/.test(err.message),
  );

  await assert.rejects(
    () => removeAttachment(actor, ticket.ticketId, uploaded.attachments[0]._id, config, {
      storage: attachmentStorage, permissionContext: ctx,
    }),
    (err) => err.statusCode === 403 && /tickets\.delete/.test(err.message),
  );

  await assert.rejects(
    () => transitionTicket(actor, ticket.ticketId, { to: 'in_progress', revision: 0 }, ctx),
    (err) => err.statusCode === 400 && err.code === 'STAGE_NOT_PERMITTED',
  );
});

test('VIEW+EDIT: can edit comment and transition stage', async () => {
  const actor = await createUser({
    email: `dev-${Math.random().toString(36).slice(2)}@example.com`,
    roles: [ROLE_IDS.DEVELOPER],
  });
  const project = await Project.create({
    key: 'WEB', name: 'Web App', status: 'active', createdBy: actor._id,
  });
  const ticket = await createTicket(actor, {
    project: project.id, title: 'Broken login', description: 'Button does nothing on click.',
    assignedTo: String(actor._id),
  });
  await Ticket.updateOne({ _id: ticket.id }, {
    $set: {
      status: 'in_progress',
      estimatedResolutionAt: new Date(Date.now() + 7 * 86400000),
      expectedReleaseDate: new Date(Date.now() + 7 * 86400000),
    },
  });
  const ctx = permCtx(ROLE_IDS.DEVELOPER, ['tickets.view', 'tickets.edit', 'tickets.create']);

  const { comment } = await addComment(actor, ticket.ticketId, {
    content: 'Original', clientRef: 'c2',
  }, ctx);

  await editComment(actor, ticket.ticketId, comment._id, { content: 'Updated' }, ctx);
  const stored = await Ticket.findById(ticket.id);
  assert.equal(stored.comments[0].content, 'Updated');

  const moved = await transitionTicket(actor, ticket.ticketId, {
    to: 'ready_local', revision: 0,
  }, ctx);
  assert.equal(moved.ticket.status, 'ready_local');
});

test('VIEW+DELETE: can delete attachment but not edit comment without EDIT', async () => {
  const { actor, ticket } = await seedReporterTicket();
  const viewCtx = permCtx(ROLE_IDS.READ_ONLY, ['tickets.view']);
  const deleteCtx = permCtx(ROLE_IDS.READ_ONLY, ['tickets.view', 'tickets.delete']);

  const { comment } = await addComment(actor, ticket.ticketId, {
    content: 'Note', clientRef: 'c3',
  }, viewCtx);
  const uploaded = await addAttachments(actor, ticket.ticketId, [file()], config, {
    storage: attachmentStorage, permissionContext: viewCtx,
  });

  await assert.rejects(
    () => editComment(actor, ticket.ticketId, comment._id, { content: 'Nope' }, deleteCtx),
    (err) => err.statusCode === 403 && /tickets\.edit/.test(err.message),
  );

  await removeAttachment(actor, ticket.ticketId, uploaded.attachments[0]._id, config, {
    storage: attachmentStorage, permissionContext: deleteCtx,
  });
  assert.equal((await Ticket.findById(ticket.id)).attachments.length, 0);
});

test('API route layer blocks comment without VIEW and attachment delete without DELETE', async () => {
  const { actor, ticket } = await seedReporterTicket(ROLE_IDS.UNASSIGNED);

  const noView = await request(app())
    .post(`/v1/tickets/${ticket.ticketId}/comments`)
    .set('Authorization', bearer(actor))
    .send({ content: 'blocked' })
    .expect(403);
  assert.equal(noView.body.error.code, 'FORBIDDEN');

  const viewer = await createUser({
    email: `viewer-${Math.random().toString(36).slice(2)}@example.com`,
    roles: [ROLE_IDS.READ_ONLY],
  });
  await Ticket.updateOne({ _id: ticket.id }, { $set: { createdBy: viewer._id } });

  const commentRes = await request(app())
    .post(`/v1/tickets/${ticket.ticketId}/comments`)
    .set('Authorization', bearer(viewer))
    .send({ content: 'allowed', clientRef: 'route-1' })
    .expect(201);
  assert.equal(commentRes.body.content, 'allowed');

  const deleteBlocked = await request(app())
    .delete(`/v1/tickets/${ticket.ticketId}/attachments/507f1f77bcf86cd799439011`)
    .set('Authorization', bearer(viewer))
    .expect(403);
  assert.equal(deleteBlocked.body.error.code, 'FORBIDDEN');
});

test('transition route uses board lane permissions, not tickets.edit alone', async () => {
  const admin = await createUser({
    email: `admin-${Math.random().toString(36).slice(2)}@example.com`,
    roles: [ROLE_IDS.ADMIN],
  });
  const project = await Project.create({
    key: 'TRN', name: 'Transition', status: 'active', createdBy: admin._id,
  });
  const created = await request(app()).post('/v1/tickets')
    .set('Authorization', bearer(admin))
    .send({
      project: String(project._id),
      title: 'Stage test',
      description: 'Enough detail for validation.',
      assignedTo: String(admin._id),
    })
    .expect(201);

  await Ticket.updateOne({ _id: created.body.id }, {
    $set: {
      estimatedResolutionAt: new Date(Date.now() + 7 * 86400000),
      expectedReleaseDate: new Date(Date.now() + 7 * 86400000),
    },
  });

  const viewer = await createUser({
    email: `viewer-${Math.random().toString(36).slice(2)}@example.com`,
    roles: [ROLE_IDS.READ_ONLY],
  });
  await Ticket.updateOne({ _id: created.body.id }, { $set: { createdBy: viewer._id } });

  const blocked = await request(app())
    .post(`/v1/tickets/${created.body.ticketId}/transition`)
    .set('Authorization', bearer(viewer))
    .send({ to: 'in_progress', revision: 0 })
    .expect(400);

  assert.equal(blocked.body.error.code, 'STAGE_NOT_PERMITTED');
});
