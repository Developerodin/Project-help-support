import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS } from '@pms/shared';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import Ticket from '../ticket.model.js';
import { createTicket } from '../ticket.service.js';
import { addComment, editComment, deleteComment, toggleReaction } from '../comment.service.js';

withMemoryDb();

const user = (role = ROLE_IDS.DEVELOPER) => User.create({
  name: role, email: `${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password', status: 'active', role,
});

async function seed() {
  const author = await user();
  const web = await Project.create({ key: 'WEB', name: 'Web App', createdBy: author._id });
  const ticket = await createTicket(author, { project: web.id, title: 'Broken login' });
  return { author, ticket };
}

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

test('only the author may edit, and the edit is recorded in activityLog', async () => {
  const { author, ticket } = await seed();
  const stranger = await user();
  const { comment } = await addComment(author, ticket.id, { content: 'Original' });

  await assert.rejects(
    () => editComment(stranger, ticket.id, comment._id, { content: 'Hijacked' }),
    (err) => err.statusCode === 403,
  );

  await editComment(author, ticket.id, comment._id, { content: 'Corrected' });

  const stored = await Ticket.findById(ticket.id);
  assert.equal(stored.comments[0].content, 'Corrected');
  assert.ok(stored.comments[0].editedAt);
  // History is never mutated — the edit is an appended activityLog entry.
  assert.equal(stored.activityLog.at(-1).action, 'comment_edited');
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

test('commenting does not bump revision — it conflicts with nothing', async () => {
  const { author, ticket } = await seed();
  await addComment(author, ticket.id, { content: 'One' });

  assert.equal((await Ticket.findById(ticket.id)).revision, 0);
});
