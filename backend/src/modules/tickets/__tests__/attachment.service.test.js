import test from 'node:test';
import assert from 'node:assert/strict';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import Ticket from '../ticket.model.js';
import { createTicket } from '../ticket.service.js';
import { addAttachments, removeAttachment, downloadUrl } from '../attachment.service.js';

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

const user = (role = 'member') => User.create({
  name: role, email: `${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password', status: 'active', role,
});

async function seed() {
  const reporter = await user();
  const web = await Project.create({ key: 'WEB', name: 'Web App', createdBy: reporter._id });
  const ticket = await createTicket(reporter, { project: web.id, title: 'Broken login' });
  return { reporter, ticket };
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

test('an unrelated member cannot attach to a ticket they have no relationship to', async () => {
  const { ticket } = await seed();
  const stranger = await user('member');

  await assert.rejects(
    () => addAttachments(stranger, ticket.id, [file()], enabled, { storage }),
    (err) => err.statusCode === 403,
  );
});

test('download presigns ONLY after authorization and ownership both pass', async () => {
  presignCalls.length = 0;
  const { reporter, ticket } = await seed();
  const [attachment] = (await addAttachments(reporter, ticket.id, [file()], enabled, { storage })).attachments;

  const url = await downloadUrl(reporter, ticket.id, attachment._id, enabled, { storage });
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
  const stranger = await user('member');
  const [attachment] = (await addAttachments(reporter, ticket.id, [file()], enabled, { storage })).attachments;

  await assert.rejects(
    () => downloadUrl(stranger, ticket.id, attachment._id, enabled, { storage }),
    (err) => err.statusCode === 403 && err.code === 'FORBIDDEN',
  );
  assert.equal(presignCalls.length, 0, 'no URL was minted without authorization');
});

test('only the uploader or an admin may delete', async () => {
  deleteCalls.length = 0;
  const { reporter, ticket } = await seed();
  const stranger = await user('member');
  const admin = await user('admin');
  const [attachment] = (await addAttachments(reporter, ticket.id, [file()], enabled, { storage })).attachments;

  await assert.rejects(
    () => removeAttachment(stranger, ticket.id, attachment._id, enabled, { storage }),
    (err) => err.statusCode === 403,
  );

  await removeAttachment(admin, ticket.id, attachment._id, enabled, { storage });
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
