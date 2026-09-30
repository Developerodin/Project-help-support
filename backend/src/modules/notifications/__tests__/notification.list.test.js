import test from 'node:test';
import assert from 'node:assert/strict';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import Ticket from '../../tickets/ticket.model.js';
import Notification from '../notification.model.js';
import {
  backfillNotificationProjects, listNotifications, markAllRead,
} from '../notification.service.js';

withMemoryDb();

const user = () => User.create({
  name: 'Ada',
  email: `${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password',
  status: 'active',
  role: 'developer',
});

async function fixture() {
  const actor = await user();
  const web = await Project.create({ key: 'WEB', name: 'Web', createdBy: actor._id });
  const ele = await Project.create({ key: 'ELE', name: 'Ele', createdBy: actor._id });

  const webTicket = await Ticket.create({
    ticketId: 'WEB-1',
    project: web._id,
    title: 'Web issue',
    description: 'x',
    createdBy: actor._id,
    severity: 'Minor',
    priority: 'Low',
    status: 'pending',
  });
  const eleTicket = await Ticket.create({
    ticketId: 'ELE-1',
    project: ele._id,
    title: 'Ele issue',
    description: 'x',
    createdBy: actor._id,
    severity: 'Minor',
    priority: 'Low',
    status: 'pending',
  });

  await Notification.create([
    {
      user: actor._id,
      event: 'TICKET_CREATED',
      ticket: webTicket._id,
      project: web._id,
      title: 'Ada filed WEB-1',
      body: 'Web issue',
      link: '/tickets?ticket=WEB-1',
    },
    {
      user: actor._id,
      event: 'TICKET_CREATED',
      ticket: eleTicket._id,
      project: ele._id,
      title: 'Ada filed ELE-1',
      body: 'Ele issue',
      link: '/tickets?ticket=ELE-1',
    },
  ]);

  return { actor, web, ele, webTicket, eleTicket };
}

test('listNotifications returns all projects when project filter omitted', async () => {
  const { actor } = await fixture();
  const page = await listNotifications(actor, { limit: 10 });
  assert.equal(page.totalResults, 2);
});

test('listNotifications filters by project query param', async () => {
  const { actor, web, ele } = await fixture();
  const webPage = await listNotifications(actor, { limit: 10, project: String(web._id) });
  assert.equal(webPage.totalResults, 1);
  assert.match(webPage.results[0].title, /WEB-1$/);

  const elePage = await listNotifications(actor, { limit: 10, project: String(ele._id) });
  assert.equal(elePage.totalResults, 1);
  assert.match(elePage.results[0].title, /ELE-1$/);
});

test('each result carries its project key and name for the chip', async () => {
  const { actor } = await fixture();
  const page = await listNotifications(actor, { limit: 10 });
  const keys = page.results.map((n) => n.project.key).sort();
  assert.deepEqual(keys, ['ELE', 'WEB']);
  assert.ok(page.results.every((n) => typeof n.project.name === 'string'));
  const web = page.results.find((n) => n.project.key === 'WEB');
  assert.deepEqual(Object.keys(web.project).sort(), ['id', 'key', 'name']);
  assert.equal(web.ticket.id, String(web.ticket.id));
  assert.ok(web.ticket.id, 'the populated ticket exposes id');
});

test('read-all with no params clears every project', async () => {
  const { actor } = await fixture();
  assert.equal((await markAllRead(actor, {})).updated, 2);
  assert.equal((await listNotifications(actor, { unread: 'true', limit: 1 })).totalResults, 0);
});

test('unread count across projects is totalResults of unread=true&limit=1', async () => {
  const { actor, web } = await fixture();
  await markAllRead(actor, { project: String(web._id) });
  const page = await listNotifications(actor, { unread: 'true', limit: 1 });
  assert.equal(page.totalResults, 1);
});

test('read-all with a ticket marks only the rows on that ticket', async () => {
  const { actor, webTicket, eleTicket } = await fixture();
  const other = await user();
  await Notification.create({
    user: other._id, event: 'TICKET_CREATED', ticket: webTicket._id, title: 't',
  });

  const result = await markAllRead(actor, { ticket: String(webTicket._id) });
  assert.equal(result.updated, 1);
  assert.ok((await Notification.findOne({ user: actor._id, ticket: webTicket._id })).readAt);
  assert.equal((await Notification.findOne({ user: actor._id, ticket: eleTicket._id })).readAt, null);
  assert.equal((await Notification.findOne({ user: other._id })).readAt, null, 'rows of another user are untouched');
});

test('the boot backfill copies the ticket project onto rows missing one', async () => {
  const { actor, web, webTicket } = await fixture();
  await Notification.collection.insertOne({
    user: actor._id, event: 'TICKET_CREATED', ticket: webTicket._id, title: 'legacy', readAt: null,
  });

  assert.equal(await backfillNotificationProjects(), 1);
  const legacy = await Notification.findOne({ title: 'legacy' });
  assert.equal(String(legacy.project), String(web._id));
  assert.equal(await backfillNotificationProjects(), 0, 'a second run finds nothing to do');
});
