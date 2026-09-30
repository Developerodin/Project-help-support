import test from 'node:test';
import assert from 'node:assert/strict';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import Ticket from '../../tickets/ticket.model.js';
import Notification from '../notification.model.js';
import {
  backfillNotificationActivity, createInAppNotifications, listNotifications, markAllRead,
} from '../notification.service.js';

withMemoryDb();

const config = { frontendBaseUrl: 'http://localhost:3000' };

const user = (name) => User.create({
  name, email: `${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password', status: 'active', role: 'developer',
});

async function fixture() {
  const reporter = await user('Ada');
  const watcher = await user('Bo');
  const project = await Project.create({ key: 'WEB', name: 'Web', createdBy: reporter._id });
  const ticket = await Ticket.create({
    ticketId: 'WEB-1', project: project._id, title: 'Broken login', createdBy: reporter._id,
  });
  return { reporter, watcher, ticket };
}

const to = (...users) => users.map((u) => ({ user: u, channels: { inApp: true } }));
const notify = (event, ticket, users, context = { actorName: 'Ravi' }) => (
  createInAppNotifications(event, ticket, to(...users), config, context)
);

test('routine updates fold into the one unread row for the ticket', async () => {
  const { watcher, ticket } = await fixture();

  const [first] = await notify('TICKET_CREATED', ticket, [watcher]);
  const [second] = await notify('TICKET_STAGE_CHANGED', ticket, [watcher], { actorName: 'Ravi', to: 'in_progress' });

  assert.equal(String(second._id), String(first._id), 'the folded row keeps its id');
  const rows = await Notification.find({ user: watcher._id });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 2);
  assert.equal(rows[0].event, 'TICKET_STAGE_CHANGED');
  assert.equal(rows[0].title, 'Ravi moved WEB-1 to In Progress', 'latest title, no count baked in');
  assert.ok(rows[0].activityAt >= first.activityAt);
});

test('a read row is not folded into: the next update starts a new one', async () => {
  const { watcher, ticket } = await fixture();
  await notify('TICKET_CREATED', ticket, [watcher]);
  await markAllRead(watcher, {});

  await notify('TICKET_CLOSED', ticket, [watcher]);

  assert.equal(await Notification.countDocuments({ user: watcher._id }), 2);
  assert.equal(await Notification.countDocuments({ user: watcher._id, readAt: null, count: 1 }), 1);
});

test('for-you events always get their own row and are never folded into', async () => {
  const { reporter, watcher, ticket } = await fixture();
  await notify('TICKET_CREATED', ticket, [reporter, watcher]);

  // A comment is for the reporter (they raised it) but routine for the watcher.
  await notify('TICKET_COMMENTED', ticket, [reporter, watcher]);
  await notify('TICKET_MENTIONED', ticket, [watcher]);
  await notify('TICKET_CLOSED', ticket, [reporter, watcher]);

  const reporterRows = await Notification.find({ user: reporter._id }).sort({ createdAt: 1 });
  assert.deepEqual(reporterRows.map((r) => [r.event, r.forYou, r.count]), [
    ['TICKET_CLOSED', false, 2],
    ['TICKET_COMMENTED', true, 1],
  ]);
  const watcherRows = await Notification.find({ user: watcher._id }).sort({ createdAt: 1 });
  assert.deepEqual(watcherRows.map((r) => [r.event, r.forYou, r.count]), [
    ['TICKET_CLOSED', false, 3],
    ['TICKET_MENTIONED', true, 1],
  ]);
});

test('an assignment is for the new assignee only', async () => {
  const { reporter, watcher, ticket } = await fixture();
  await Ticket.updateOne({ _id: ticket._id }, { $set: { assignedTo: watcher._id } });
  const assigned = await Ticket.findById(ticket._id);

  await notify('TICKET_ASSIGNED', assigned, [reporter, watcher]);

  assert.equal((await Notification.findOne({ user: watcher._id })).forYou, true);
  assert.equal((await Notification.findOne({ user: reporter._id })).forYou, false);
});

test('the list sorts by latest activity and filters to for-you rows', async () => {
  const { reporter, watcher, ticket } = await fixture();
  const other = await Ticket.create({
    ticketId: 'WEB-2', project: ticket.project, title: 'Second', createdBy: reporter._id,
  });
  // A few ms apart, so activityAt (not the _id tie-break) decides the order.
  const tick = () => new Promise((resolve) => { setTimeout(resolve, 5); });
  await notify('TICKET_CREATED', ticket, [watcher]);
  await tick();
  await notify('TICKET_CREATED', other, [watcher]);
  await tick();
  await notify('TICKET_MENTIONED', other, [watcher]);
  await tick();
  // WEB-1 was created first, but its row gains an update last.
  await notify('TICKET_CLOSED', ticket, [watcher]);

  const all = await listNotifications(watcher, { limit: 10 });
  assert.deepEqual(all.results.map((r) => [r.title, r.count, r.forYou]), [
    ['Ravi closed WEB-1', 2, false],
    ['Ravi mentioned you on WEB-2', 1, true],
    ['Ravi filed WEB-2', 1, false],
  ]);
  assert.ok(all.results.every((r) => r.activityAt instanceof Date));

  const forYou = await listNotifications(watcher, { forYou: 'true', limit: 10 });
  assert.deepEqual(forYou.results.map((r) => r.title), ['Ravi mentioned you on WEB-2']);
  assert.equal((await listNotifications(watcher, { forYou: 'true', unread: 'true', limit: 1 })).totalResults, 1);
});

test('read-all for a ticket clears both its for-you and its folded rows', async () => {
  const { watcher, ticket } = await fixture();
  await notify('TICKET_CREATED', ticket, [watcher]);
  await notify('TICKET_MENTIONED', ticket, [watcher]);

  assert.equal((await markAllRead(watcher, { ticket: String(ticket._id) })).updated, 2);
});

test('the boot backfill gives old rows an activityAt from createdAt, once', async () => {
  const { watcher, ticket } = await fixture();
  const createdAt = new Date('2026-01-02T03:04:05Z');
  await Notification.collection.insertOne({
    user: watcher._id, event: 'TICKET_CREATED', ticket: ticket._id, title: 'legacy', readAt: null, createdAt,
  });

  assert.equal(await backfillNotificationActivity(), 1);
  const legacy = await Notification.findOne({ title: 'legacy' }).lean();
  assert.deepEqual(legacy.activityAt, createdAt);
  assert.equal(legacy.count, 1);
  assert.equal(await backfillNotificationActivity(), 0, 'a second run finds nothing to do');
});
