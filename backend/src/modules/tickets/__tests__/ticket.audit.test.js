import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS } from '@pms/shared';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import RbacAuditLog from '../../rbac/rbacAuditLog.model.js';
import RbacAuditOutbox from '../../rbac/rbacAuditOutbox.model.js';
import { listAuditLog } from '../../rbac/rbac.service.js';
import Ticket from '../ticket.model.js';
import {
  createTicket, deleteTicket, patchTicket, setBlocked, unwatchTicket, watchTicket,
} from '../ticket.service.js';
import { transitionTicket } from '../transition.service.js';
import { addComment } from '../comment.service.js';
import { updateTicketSettings } from '../../notifications/ticket-settings.service.js';

withMemoryDb();

const user = (role = ROLE_IDS.ADMIN) => User.create({
  name: `${role} user`,
  email: `${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password',
  status: 'active',
  role,
  roles: [role],
});

async function seed() {
  const admin = await user(ROLE_IDS.ADMIN);
  const dev = await user(ROLE_IDS.DEVELOPER);
  const web = await Project.create({ key: 'WEB', name: 'Web App', createdBy: admin._id });
  const ticket = await createTicket(admin, { project: web.id, title: 'Broken login', assignedTo: dev._id });
  return { admin, dev, web, ticket };
}

test('creating a ticket writes a ticket audit row with the ticket id, project and actor', async () => {
  const { admin, web, ticket } = await seed();

  const row = await RbacAuditLog.findOne({ action: 'ticket.created' });
  assert.ok(row);
  assert.equal(row.category, 'ticket');
  assert.equal(row.ticketId, ticket.ticketId);
  assert.equal(String(row.project), String(web._id));
  assert.equal(String(row.actor), String(admin._id));
  assert.equal(row.details.title, 'Broken login');
  assert.equal(row.details.projectKey, 'WEB');
  assert.equal(row.details.via, 'app');
});

test('a stage change stores from and to', async () => {
  const { admin, ticket } = await seed();

  await transitionTicket(admin, ticket.id, { to: 'under_review', revision: 0 });

  const row = await RbacAuditLog.findOne({ action: 'ticket.transitioned' });
  assert.ok(row);
  assert.equal(row.ticketId, ticket.ticketId);
  assert.equal(row.details.from, 'pending');
  assert.equal(row.details.to, 'under_review');
});

test('a patch logs only the fields whose value changed', async () => {
  const { admin, ticket } = await seed();

  await patchTicket(admin, ticket.id, { revision: 0, title: 'Broken login', priority: 'High' });

  const row = await RbacAuditLog.findOne({ action: 'ticket.updated' });
  assert.ok(row);
  assert.deepEqual(row.details.changes.map((c) => c.field), ['priority']);
  assert.equal(row.details.changes[0].to, 'High');
});

test('a comment is audited by id without its body', async () => {
  const { admin, ticket } = await seed();

  const { comment } = await addComment(admin, ticket.id, { content: 'Secret repro steps' });

  const row = await RbacAuditLog.findOne({ action: 'ticket.comment_added' });
  assert.ok(row);
  assert.equal(row.details.commentId, String(comment._id));
  assert.ok(!JSON.stringify(row.details).includes('Secret repro steps'));
});

test('deleting a ticket writes ticket.deleted and the trail outlives the ticket', async () => {
  const { admin, ticket } = await seed();
  await setBlocked(admin, ticket.id, { revision: 0, reason: 'Waiting on API' });

  await deleteTicket(ticket.id, admin);

  assert.equal(await Ticket.countDocuments({ _id: ticket.id }), 0);
  const deleted = await RbacAuditLog.findOne({ action: 'ticket.deleted' });
  assert.ok(deleted);
  assert.equal(deleted.ticketId, ticket.ticketId);
  assert.equal(deleted.details.title, 'Broken login');
  assert.equal(String(deleted.actor), String(admin._id));

  const trail = await RbacAuditLog.find({ ticketId: ticket.ticketId }).distinct('action');
  assert.deepEqual(trail.sort(), ['ticket.blocked', 'ticket.created', 'ticket.deleted']);
});

test('a delete that fails leaves the ticket and writes no ticket.deleted row', async () => {
  const { admin, ticket } = await seed();
  const deleteMock = mock.method(Ticket, 'deleteOne', async () => {
    throw new Error('simulated delete failure');
  });

  try {
    await assert.rejects(deleteTicket(ticket.id, admin), /simulated delete failure/);
  } finally {
    deleteMock.mock.restore();
  }

  assert.equal(await Ticket.countDocuments({ _id: ticket.id }), 1);
  assert.equal(await RbacAuditLog.countDocuments({ action: 'ticket.deleted' }), 0);
});

test('a delete that removes nothing (lost race) writes no ticket.deleted row', async () => {
  const { admin, ticket } = await seed();
  const deleteMock = mock.method(Ticket, 'deleteOne', async () => ({ acknowledged: true, deletedCount: 0 }));

  try {
    await deleteTicket(ticket.id, admin);
  } finally {
    deleteMock.mock.restore();
  }

  assert.equal(await RbacAuditLog.countDocuments({ action: 'ticket.deleted' }), 0);
});

test('repeated watch/unwatch clicks log only the real changes', async () => {
  const { ticket } = await seed();
  const watcher = await user(ROLE_IDS.ADMIN);

  await unwatchTicket(watcher, ticket.id);
  await watchTicket(watcher, ticket.id);
  await watchTicket(watcher, ticket.id);
  await unwatchTicket(watcher, ticket.id);
  await unwatchTicket(watcher, ticket.id);

  const rows = await RbacAuditLog.find({ ticketId: ticket.ticketId, action: /watched$/ }).sort({ createdAt: 1 });
  assert.deepEqual(rows.map((r) => r.action), ['ticket.watched', 'ticket.unwatched']);
});

test('following from notification settings is audited like the watch button', async () => {
  const { ticket } = await seed();
  const watcher = await user(ROLE_IDS.ADMIN);

  await updateTicketSettings(watcher, ticket.id, { following: true });
  await updateTicketSettings(watcher, ticket.id, { following: true });
  await updateTicketSettings(watcher, ticket.id, { following: false });

  const rows = await RbacAuditLog.find({ ticketId: ticket.ticketId, action: /watched$/ }).sort({ createdAt: 1 });
  assert.deepEqual(rows.map((r) => r.action), ['ticket.watched', 'ticket.unwatched']);
  assert.ok(rows.every((r) => String(r.actor) === String(watcher._id)));
  assert.ok(rows.every((r) => r.category === 'ticket'));
});

test('the Tickets category and a typed ticket id both find the rows', async () => {
  const { admin, ticket } = await seed();

  const byCategory = await listAuditLog(admin, { category: 'ticket', limit: 20 });
  assert.ok(byCategory.results.length >= 1);
  assert.ok(byCategory.results.every((row) => row.category === 'ticket'));
  assert.equal(byCategory.results[0].actor.id, String(admin._id));

  const byTicket = await listAuditLog(admin, { action: ticket.ticketId.toLowerCase(), limit: 20 });
  assert.ok(byTicket.results.length >= 1);
  assert.ok(byTicket.results.every((row) => row.ticketId === ticket.ticketId));
  assert.equal(byTicket.results[0].subjectNames.project, 'Web App');
});

test('a failed audit write does not fail the ticket mutation', async () => {
  const admin = await user(ROLE_IDS.ADMIN);
  const web = await Project.create({ key: 'APP', name: 'App', createdBy: admin._id });
  const createMock = mock.method(RbacAuditLog, 'create', async () => {
    throw new Error('simulated audit write failure');
  });

  try {
    const ticket = await createTicket(admin, { project: web.id, title: 'Still filed' });
    assert.equal(ticket.ticketId, 'APP-1');
  } finally {
    createMock.mock.restore();
  }

  assert.equal(await RbacAuditOutbox.countDocuments({ action: 'ticket.created' }), 1);
});

test('deleting a ticket archives the whole document and clears what points at it', async () => {
  const { admin, web, ticket } = await seed();
  const { default: DeletedTicket } = await import('../deleted-ticket.model.js');
  const { default: TicketReadState } = await import('../ticket-read-state.model.js');
  const { default: TicketMute } = await import('../../notifications/ticketMute.model.js');
  const { default: EmailLog } = await import('../../notifications/emailLog.model.js');
  await addComment(admin, ticket.id, { content: 'Repro: click twice' });
  const other = await createTicket(admin, { project: web.id, title: 'Linked' });
  await Ticket.updateOne({ _id: other.id }, { $push: { links: { rel: 'relates-to', ticket: ticket.id } } });
  await TicketReadState.create({ user: admin._id, ticket: ticket.id, lastReadAt: new Date() });
  await TicketMute.create({ user: admin._id, ticket: ticket.id });
  const base = { event: 'TICKET_COMMENTED', ticket: ticket.id, recipientUserId: admin._id };
  await EmailLog.create({ ...base, eventId: 'q', status: 'queued' });
  await EmailLog.create({ ...base, eventId: 's', status: 'sent', sentAt: new Date() });

  await deleteTicket(ticket.id, admin);

  const archived = await DeletedTicket.findOne({ ticketId: ticket.ticketId }).lean();
  assert.ok(archived, 'the deleted ticket is archived');
  assert.equal(String(archived.deletedBy), String(admin._id));
  assert.equal(archived.snapshot.comments[0].content, 'Repro: click twice');
  assert.equal(await TicketReadState.countDocuments({ ticket: ticket.id }), 0);
  assert.equal(await TicketMute.countDocuments({ ticket: ticket.id }), 0);
  assert.equal((await EmailLog.findOne({ eventId: 'q' })).status, 'skipped');
  assert.equal((await EmailLog.findOne({ eventId: 's' })).status, 'sent');
  assert.equal((await Ticket.findById(other.id)).links.length, 0);
});
