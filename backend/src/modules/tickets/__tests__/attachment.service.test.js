import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS } from '@pms/shared';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import Client from '../../clients/client.model.js';
import AccessAssignment from '../../access/accessAssignment.model.js';
import Ticket from '../ticket.model.js';
import { createTicket } from '../ticket.service.js';
import { addAttachments, removeAttachment, downloadUrl } from '../attachment.service.js';
import { addComment } from '../comment.service.js';
import { updateRoleMatrix } from '../../rbac/rbac.service.js';

withMemoryDb();

// The S3 calls are injected, so these tests exercise the AUTHORIZATION and
// VALIDATION paths without a network. The SDK itself is not under test.
const putCalls = [];
const presignCalls = [];
const deleteCalls = [];

const storage = {
  putObject: async (_config, args) => { putCalls.push(args); },
  deleteObject: async (_config, key) => { deleteCalls.push(key); },
  presignGet: async (_config, key, opts) => {
    presignCalls.push({ key, opts });
    return `https://bucket.example/${key}?sig=x`;
  },
};

const enabled = { features: { attachments: true }, storage: { bucket: 'b', region: 'r' } };
const disabled = { features: { attachments: false }, storage: null };

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(16),
]);

const file = (originalname = 'shot.png', buffer = png) => ({
  originalname, buffer, size: buffer.length, mimetype: 'application/octet-stream',
});

const user = (role = ROLE_IDS.DEVELOPER) => User.create({
  name: role, email: `${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password', status: 'active', role,
});

async function seed() {
  const reporter = await user();
  const web = await Project.create({ key: 'WEB', name: 'Web App', createdBy: reporter._id });
  const ticket = await createTicket(reporter, { project: web.id, title: 'Broken login' });
  return { reporter, ticket };
}

/**
 * Task 10's coercion-test fixture, reused: a Client-owned project, a
 * client_tester scoped to it via AccessAssignment, and a ticket whose
 * createdBy is reassigned to that tester so canExternalViewTicket's
 * creator-match rule is satisfied.
 */
async function seedExternalScope() {
  const admin = await user(ROLE_IDS.ADMIN);
  const tester = await user(ROLE_IDS.CLIENT_TESTER);
  const company = await Client.create({
    name: `Co-${Math.random().toString(36).slice(2)}`, status: 'active', createdBy: admin._id,
  });
  const project = await Project.create({
    key: 'EXT', name: 'External', client: company._id, createdBy: admin._id,
  });
  await AccessAssignment.create({
    user: tester._id, role: ROLE_IDS.CLIENT_TESTER,
    client: company._id, project: project._id, status: 'active', grantedBy: admin._id,
  });
  await updateRoleMatrix(admin, {
    grants: { [ROLE_IDS.CLIENT_TESTER]: ['tickets.view'] },
  });
  const ticket = await createTicket(admin, { project: project.id, title: 'Raised for client' });
  await Ticket.updateOne({ _id: ticket.id }, { $set: { createdBy: tester._id } });
  return { admin, tester, ticket };
}

test('an upload stores a key built from the user id, never the filename', async () => {
  putCalls.length = 0;
  const { reporter, ticket } = await seed();

  const result = await addAttachments(
    reporter, ticket.id, [file('../../etc/passwd.png')], enabled, { storage },
  );

  assert.equal(result.attachments.length, 1);
  assert.match(result.attachments[0].key, new RegExp(`^tickets/${reporter._id}/`));
  assert.equal(result.attachments[0].name, '../../etc/passwd.png', 'the original name is kept as metadata');
  assert.equal(result.attachments[0].mimeType, 'image/png');
  assert.equal(putCalls[0].key, result.attachments[0].key);
});

test('no url is ever stored on the attachment', async () => {
  const { reporter, ticket } = await seed();
  await addAttachments(reporter, ticket.id, [file()], enabled, { storage });

  const stored = await Ticket.findById(ticket.id);
  assert.equal(stored.attachments[0].url, undefined);
  assert.ok(stored.attachments[0].key);
});

test('a rejected file never reaches storage', async () => {
  putCalls.length = 0;
  const { reporter, ticket } = await seed();

  await assert.rejects(
    () => addAttachments(reporter, ticket.id, [file('payload.svg')], enabled, { storage }),
    (err) => err.statusCode === 400 && err.code === 'BLOCKED_FILE_TYPE',
  );

  assert.equal(putCalls.length, 0, 'validation runs before the upload');
  assert.equal((await Ticket.findById(ticket.id)).attachments.length, 0);
});

test('a replayed clientRef adds nothing', async () => {
  const { reporter, ticket } = await seed();

  await addAttachments(reporter, ticket.id, [file()], enabled, { storage, clientRef: 'up-1' });
  await addAttachments(reporter, ticket.id, [file()], enabled, { storage, clientRef: 'up-1' });

  assert.equal((await Ticket.findById(ticket.id)).attachments.length, 1);
});

test('an unrelated member cannot attach to a ticket they cannot view', async () => {
  const { ticket } = await seed();
  const stranger = await user(ROLE_IDS.DEVELOPER);

  await assert.rejects(
    () => addAttachments(stranger, ticket.id, [file()], enabled, { storage }),
    (err) => err.statusCode === 403,
  );
});

test('download presigns ONLY after authorization and ownership both pass', async () => {
  presignCalls.length = 0;
  const { reporter, ticket } = await seed();
  const [attachment] = (await addAttachments(reporter, ticket.id, [file()], enabled, { storage })).attachments;

  const { url } = await downloadUrl(reporter, ticket.id, attachment._id, enabled, { storage });
  assert.match(url, /^https:\/\/bucket\.example\//);
  assert.equal(presignCalls.length, 1);

  await assert.rejects(
    () => downloadUrl(reporter, ticket.id, '507f1f77bcf86cd799439011', enabled, { storage }),
    (err) => err.statusCode === 404 && err.code === 'ATTACHMENT_NOT_FOUND',
  );
  assert.equal(presignCalls.length, 1, 'no URL was minted for the failed lookup');
});

test('an unrelated member cannot download attachments on a ticket they cannot view', async () => {
  presignCalls.length = 0;
  const { reporter, ticket } = await seed();
  const stranger = await user(ROLE_IDS.DEVELOPER);
  const [attachment] = (await addAttachments(reporter, ticket.id, [file()], enabled, { storage })).attachments;

  await assert.rejects(
    () => downloadUrl(stranger, ticket.id, attachment._id, enabled, { storage }),
    (err) => err.statusCode === 403 && err.code === 'FORBIDDEN',
  );
  assert.equal(presignCalls.length, 0, 'no URL was minted without authorization');
});

test('only a user with DELETE permission may remove an attachment', async () => {
  deleteCalls.length = 0;
  const { reporter, ticket } = await seed();
  const viewer = await user(ROLE_IDS.READ_ONLY);
  const deleter = await user(ROLE_IDS.ADMIN);
  const [attachment] = (await addAttachments(reporter, ticket.id, [file()], enabled, { storage })).attachments;

  await assert.rejects(
    () => removeAttachment(viewer, ticket.id, attachment._id, enabled, { storage }),
    (err) => err.statusCode === 403,
  );

  await removeAttachment(deleter, ticket.id, attachment._id, enabled, { storage });
  assert.equal((await Ticket.findById(ticket.id)).attachments.length, 0);
  assert.equal(deleteCalls.length, 1);
});

test('with no storage group configured, attachment paths report 503', async () => {
  const { reporter, ticket } = await seed();

  await assert.rejects(
    () => addAttachments(reporter, ticket.id, [file()], disabled, { storage }),
    (err) => err.statusCode === 503 && err.code === 'CAPABILITY_DISABLED',
  );
});

test('commentContent creates a comment with inline attachments', async () => {
  const { reporter, ticket } = await seed();

  const result = await addAttachments(reporter, ticket.id, [file()], enabled, {
    storage,
    commentContent: 'See attached',
    commentClientRef: 'cmt-1',
  });

  assert.equal(result.attachments.length, 1);
  assert.equal(result.commentCreated, true);
  assert.equal(result.comment.content, 'See attached');
  assert.equal(result.comment.attachments.length, 1);
  assert.equal(String(result.comment.attachments[0]._id), String(result.attachments[0]._id));

  const stored = await Ticket.findById(ticket.id);
  assert.equal(stored.comments.length, 1);
  assert.equal(stored.comments[0].attachments.length, 1);
  assert.equal(stored.attachments.length, 1);
});

test('an external actor cannot attach into an internal comment, but may attach into their own public one', async () => {
  const { admin, tester, ticket } = await seedExternalScope();
  const { comment: internalComment } = await addComment(admin, ticket.id, {
    content: 'internal note', internal: true,
  });
  const { comment: publicComment } = await addComment(tester, ticket.id, { content: 'update', clientRef: 'own-1' });

  await assert.rejects(
    () => addAttachments(tester, ticket.id, [file()], enabled, {
      storage, commentId: internalComment._id,
    }),
    (err) => err.statusCode === 403 && err.code === 'FORBIDDEN',
  );

  const result = await addAttachments(tester, ticket.id, [file()], enabled, {
    storage, commentId: publicComment._id,
  });
  assert.equal(result.attachments.length, 1);
  assert.equal(String(result.comment._id), String(publicComment._id));
});

test("attaching into someone else's comment is refused, even for an internal user", async () => {
  const { admin, ticket } = await seedExternalScope();
  const other = await User.create({
    name: 'Dev', email: `${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-long-enough-password', status: 'active', role: ROLE_IDS.ADMIN,
  });
  const { comment } = await addComment(admin, ticket.id, { content: 'mine' });

  await assert.rejects(
    () => addAttachments(other, ticket.id, [file()], enabled, { storage, commentId: comment._id }),
    (err) => err.statusCode === 403 && err.code === 'FORBIDDEN',
  );
  assert.equal((await Ticket.findById(ticket.id)).comments.id(comment._id).attachments.length, 0);
});

test('an external in-scope actor cannot download a QA report attachment', async () => {
  presignCalls.length = 0;
  const { admin, tester, ticket } = await seedExternalScope();

  const uploaded = await addAttachments(admin, ticket.id, [file()], enabled, { storage });
  const evidenceId = uploaded.attachments[0]._id;

  // Filed as stage-history evidence, exactly as a Reject does. The id is on the
  // ticket-level array too, so only the stageHistory check can refuse it.
  await Ticket.updateOne({ _id: ticket.id }, {
    $push: {
      stageHistory: {
        from: 'ready_qa', to: 'in_progress', by: admin._id, decision: 'rejected',
        note: 'fails on Safari', attachments: [uploaded.attachments[0].toObject()],
      },
    },
  });

  await assert.rejects(
    () => downloadUrl(tester, ticket.id, evidenceId, enabled, { storage }),
    (err) => err.statusCode === 403 && err.code === 'FORBIDDEN',
  );
  assert.equal(presignCalls.length, 0, 'no URL was minted for the QA report attachment');
});

test("an external in-scope actor cannot download an internal comment's attachment, but may download a public comment's", async () => {
  presignCalls.length = 0;
  const { admin, tester, ticket } = await seedExternalScope();
  const { comment: internalComment } = await addComment(admin, ticket.id, {
    content: 'internal note', internal: true,
  });
  const { comment: publicComment } = await addComment(admin, ticket.id, { content: 'update' });

  const internalUpload = await addAttachments(admin, ticket.id, [file()], enabled, {
    storage, commentId: internalComment._id,
  });
  const publicUpload = await addAttachments(admin, ticket.id, [file()], enabled, {
    storage, commentId: publicComment._id,
  });

  await assert.rejects(
    () => downloadUrl(tester, ticket.id, internalUpload.attachments[0]._id, enabled, { storage }),
    (err) => err.statusCode === 403 && err.code === 'FORBIDDEN',
  );

  const { url } = await downloadUrl(tester, ticket.id, publicUpload.attachments[0]._id, enabled, { storage });
  assert.match(url, /^https:\/\/bucket\.example\//);
  assert.equal(presignCalls.length, 1, 'no URL was minted for the internal-comment attachment');
});

test('download presigns with the original filename, not the storage key', async () => {
  presignCalls.length = 0;
  const { reporter, ticket } = await seed();
  const [attachment] = (await addAttachments(
    reporter, ticket.id, [file('Q3-spec.png')], enabled, { storage },
  )).attachments;

  const { url, filename } = await downloadUrl(reporter, ticket.id, attachment._id, enabled, { storage });

  assert.match(url, /^https:\/\/bucket\.example\//);
  assert.equal(attachment.name, 'Q3-spec.png');
  assert.ok(!attachment.key.includes('Q3-spec'), 'storage key stays random');
  assert.equal(presignCalls[0].key, attachment.key);
  assert.equal(presignCalls[0].opts?.filename, 'Q3-spec.png');
  assert.equal(filename, 'Q3-spec.png');
});
