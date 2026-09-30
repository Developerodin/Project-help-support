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
import { addComment, editComment, deleteComment, toggleReaction } from '../comment.service.js';
import { addAttachments } from '../attachment.service.js';
import { updateRoleMatrix } from '../../rbac/rbac.service.js';

withMemoryDb();

const user = (role = ROLE_IDS.DEVELOPER) => User.create({
  name: role, email: `${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password', status: 'active', role,
});

function permCtx(role, permissions) {
  return { roleMatrix: { [role]: permissions }, userOverrides: {}, scopedAssignments: [] };
}

async function seed() {
  const author = await user();
  const web = await Project.create({ key: 'WEB', name: 'Web App', createdBy: author._id });
  const ticket = await createTicket(author, { project: web.id, title: 'Broken login' });
  return { author, ticket };
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
  return { admin, tester, company, project, ticket };
}

const attachmentStorage = {
  putObject: async () => {},
  deleteObject: async () => {},
  presignGet: async () => '',
};
const attachmentsEnabled = { features: { attachments: true }, storage: { bucket: 'b', region: 'r' } };
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(16),
]);
const file = (originalname = 'shot.png', buffer = png) => ({
  originalname, buffer, size: buffer.length, mimetype: 'application/octet-stream',
});

test('a comment is appended and returned', async () => {
  const { author, ticket } = await seed();

  const { comment, created, event } = await addComment(author, ticket.id, {
    content: 'Reproduced on Safari', clientRef: 'ref-1',
  });

  assert.equal(created, true);
  assert.equal(comment.content, 'Reproduced on Safari');
  assert.equal(event.type, 'TICKET_COMMENTED');
  assert.equal((await Ticket.findById(ticket.id)).comments.length, 1);
});

test('a replayed clientRef returns the existing comment and creates no duplicate', async () => {
  const { author, ticket } = await seed();
  const payload = { content: 'Reproduced on Safari', clientRef: 'ref-1' };

  const first = await addComment(author, ticket.id, payload);
  const replay = await addComment(author, ticket.id, payload);

  assert.equal(replay.created, false);
  assert.equal(String(replay.comment._id), String(first.comment._id));
  assert.equal((await Ticket.findById(ticket.id)).comments.length, 1);
});

test('concurrent submissions of one clientRef still produce one comment', async () => {
  const { author, ticket } = await seed();
  const payload = { content: 'Double-click', clientRef: 'ref-double' };

  await Promise.all([
    addComment(author, ticket.id, payload),
    addComment(author, ticket.id, payload),
  ]);

  assert.equal((await Ticket.findById(ticket.id)).comments.length, 1);
});

test('two different clientRefs are two comments', async () => {
  const { author, ticket } = await seed();

  await addComment(author, ticket.id, { content: 'One', clientRef: 'a' });
  await addComment(author, ticket.id, { content: 'Two', clientRef: 'b' });

  assert.equal((await Ticket.findById(ticket.id)).comments.length, 2);
});

test('a Super Admin CAN be @mentioned in a comment, unlike a ticket assignment', async () => {
  const { author, ticket } = await seed();
  const superAdmin = await User.create({
    name: 'Root', email: 'root@example.com', password: 'a-long-enough-password',
    status: 'active', role: 'super_admin',
  });

  const { comment, event } = await addComment(author, ticket.id, {
    content: 'escalate', mentions: [superAdmin._id],
  });

  assert.equal(comment.content, 'escalate');
  assert.deepEqual(event.mentions.map(String), [String(superAdmin._id)]);
});

test('mentions must resolve to active users', async () => {
  const { author, ticket } = await seed();
  const gone = await User.create({
    name: 'Gone', email: 'gone@example.com', password: 'a-long-enough-password',
    status: 'inactive',
  });

  await assert.rejects(
    () => addComment(author, ticket.id, { content: 'ping', mentions: [gone._id] }),
    (err) => err.statusCode === 400 && err.code === 'INACTIVE_USER_REFERENCE',
  );
});

test('a mention rides along on the comment event', async () => {
  const { author, ticket } = await seed();
  const mentioned = await user();

  const { event } = await addComment(author, ticket.id, {
    content: 'ping', mentions: [mentioned._id],
  });

  assert.equal(event.type, 'TICKET_COMMENTED');
  assert.deepEqual(event.mentions.map(String), [String(mentioned._id)]);
});

test('only the author may edit when they have EDIT permission', async () => {
  const { author, ticket } = await seed();
  const stranger = await user();
  const admin = await user(ROLE_IDS.ADMIN);
  const { comment } = await addComment(author, ticket.id, { content: 'Original' });

  await assert.rejects(
    () => editComment(stranger, ticket.id, comment._id, { content: 'Hijacked' }),
    (err) => err.statusCode === 403,
  );

  await editComment(author, ticket.id, comment._id, { content: 'Corrected' });

  const stored = await Ticket.findById(ticket.id);
  assert.equal(stored.comments[0].content, 'Corrected');
  assert.ok(stored.comments[0].editedAt);
  assert.equal(stored.activityLog.at(-1).action, 'comment_edited');
});

test('edit comment requires tickets.edit even for the author', async () => {
  const author = await user(ROLE_IDS.READ_ONLY);
  const filer = await user(ROLE_IDS.DEVELOPER);
  const web = await Project.create({ key: 'WEB', name: 'Web App', createdBy: filer._id });
  const ticket = await createTicket(filer, { project: web.id, title: 'Broken login' });
  await Ticket.updateOne({ _id: ticket.id }, { $set: { createdBy: author._id } });
  const ctx = permCtx(ROLE_IDS.READ_ONLY, ['tickets.view']);
  const { comment } = await addComment(author, ticket.id, { content: 'Original' }, ctx);

  await assert.rejects(
    () => editComment(author, ticket.id, comment._id, { content: 'Nope' }, ctx),
    (err) => err.statusCode === 403 && /tickets\.edit/.test(err.message),
  );
});

test('the author or an admin may delete; nobody else', async () => {
  const { author, ticket } = await seed();
  const stranger = await user(ROLE_IDS.DEVELOPER);
  const admin = await user(ROLE_IDS.ADMIN);

  const a = await addComment(author, ticket.id, { content: 'One' });
  const b = await addComment(author, ticket.id, { content: 'Two' });

  await assert.rejects(
    () => deleteComment(stranger, ticket.id, a.comment._id),
    (err) => err.statusCode === 403,
  );

  await deleteComment(author, ticket.id, a.comment._id);
  await deleteComment(admin, ticket.id, b.comment._id);

  assert.equal((await Ticket.findById(ticket.id)).comments.length, 0);
});

test('a reaction toggles on and off for the same user', async () => {
  const { author, ticket } = await seed();
  const { comment } = await addComment(author, ticket.id, { content: 'One' });

  await toggleReaction(author, ticket.id, comment._id, '+1');
  let stored = await Ticket.findById(ticket.id);
  assert.equal(stored.comments[0].reactions[0].emoji, '+1');
  assert.equal(stored.comments[0].reactions[0].users.length, 1);

  await toggleReaction(author, ticket.id, comment._id, '+1');
  stored = await Ticket.findById(ticket.id);
  assert.equal(stored.comments[0].reactions[0].users.length, 0);
});

test('an internal actor without tickets.view cannot react to a comment', async () => {
  const { author, ticket } = await seed();
  const { comment } = await addComment(author, ticket.id, { content: 'One' });
  const outsider = await user(ROLE_IDS.READ_ONLY);

  await assert.rejects(
    () => toggleReaction(outsider, ticket.id, comment._id, '+1', permCtx(ROLE_IDS.READ_ONLY, [])),
    (err) => err.statusCode === 403,
  );
  assert.equal((await Ticket.findById(ticket.id)).comments[0].reactions.length, 0);
});

test('commenting does not bump revision — it conflicts with nothing', async () => {
  const { author, ticket } = await seed();
  await addComment(author, ticket.id, { content: 'One' });

  assert.equal((await Ticket.findById(ticket.id)).revision, 0);
});

test('a comment defaults to visible and can be marked internal', async () => {
  const { author, ticket } = await seed();

  const open = await addComment(author, ticket.id, { content: 'Visible', clientRef: 'r1' });
  assert.equal(open.comment.internal, false);

  const hidden = await addComment(author, ticket.id, { content: 'Hidden', internal: true, clientRef: 'r2' });
  assert.equal(hidden.comment.internal, true);
});

test('an external actor cannot comment on a ticket outside their scope', async () => {
  const { ticket } = await seed();
  const client = await user(ROLE_IDS.CLIENT);

  await assert.rejects(
    () => addComment(client, ticket.id, { content: 'Hi', clientRef: 'r3' }),
    (err) => err.statusCode === 403 && err.code === 'FORBIDDEN',
  );
});

test('an external actor cannot mark a comment internal', async () => {
  const { tester, ticket } = await seedExternalScope();

  await assert.rejects(
    () => addComment(tester, ticket.id, {
      content: 'Any update?', internal: true, clientRef: 'r4',
    }),
    (err) => err.statusCode === 403 && err.code === 'FORBIDDEN',
  );
});

test('an external actor with no scope cannot react to a comment', async () => {
  const { author, ticket } = await seed();
  const { comment } = await addComment(author, ticket.id, { content: 'One' });
  const client = await user(ROLE_IDS.CLIENT);

  await assert.rejects(
    () => toggleReaction(client, ticket.id, comment._id, '+1'),
    (err) => err.statusCode === 403 && err.code === 'FORBIDDEN',
  );
});

test('an external actor with scope cannot react to an internal comment', async () => {
  const { admin, tester, ticket } = await seedExternalScope();
  const { comment } = await addComment(admin, ticket.id, { content: 'internal note', internal: true });

  await assert.rejects(
    () => toggleReaction(tester, ticket.id, comment._id, '+1'),
    (err) => err.statusCode === 403 && err.code === 'FORBIDDEN',
  );
});

test('an external actor with scope can react to a public comment', async () => {
  const { admin, tester, ticket } = await seedExternalScope();
  const { comment } = await addComment(admin, ticket.id, { content: 'update' });

  const updated = await toggleReaction(tester, ticket.id, comment._id, '+1');
  assert.equal(updated.reactions[0].emoji, '+1');
  assert.equal(String(updated.reactions[0].users[0]), String(tester._id));
});

test('attachment commentContent from an external actor out of scope is 403', async () => {
  const admin = await user(ROLE_IDS.ADMIN);
  const tester = await user(ROLE_IDS.CLIENT_TESTER);
  const company = await Client.create({
    name: `Co-${Math.random().toString(36).slice(2)}`, status: 'active', createdBy: admin._id,
  });
  const project = await Project.create({
    key: 'EXT2', name: 'External 2', client: company._id, createdBy: admin._id,
  });
  // No AccessAssignment created for the tester: assertCanEditTicket alone
  // would pass (they are the ticket's creator), but they are out of scope.
  const ticket = await createTicket(admin, { project: project.id, title: 'Raised for client' });
  await Ticket.updateOne({ _id: ticket.id }, { $set: { createdBy: tester._id } });

  await assert.rejects(
    () => addAttachments(tester, ticket.id, [file()], attachmentsEnabled, {
      storage: attachmentStorage, commentContent: 'Hi',
    }),
    (err) => err.statusCode === 403 && err.code === 'FORBIDDEN',
  );
});
