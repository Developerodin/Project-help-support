import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import Ticket from '../ticket.model.js';
import Team from '../../teams/team.model.js';
import { getTicket, listTickets, resolveTicketDoc } from '../ticket.service.js';

withMemoryDb();

const user = () => User.create({
  name: 'Ada', email: `${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password', status: 'active',
});

async function fixture() {
  const actor = await user();
  const other = await user();
  const web = await Project.create({ key: 'WEB', name: 'Web App', createdBy: actor._id });
  const mob = await Project.create({ key: 'MOB', name: 'Mobile App', createdBy: actor._id });

  await Ticket.init();   // the text index must exist before $text is used
  await Ticket.create([
    {
      ticketId: 'WEB-101', project: web._id, title: 'Login button does nothing',
      description: 'Clicking sign in is inert', createdBy: actor._id,
      severity: 'Critical', priority: 'Urgent', status: 'pending',
    },
    {
      ticketId: 'WEB-102', project: web._id, title: 'Slow dashboard',
      createdBy: other._id, assignedTo: actor._id, status: 'in_progress',
      severity: 'Minor', priority: 'Low',
    },
    {
      ticketId: 'MOB-1', project: mob._id, title: 'Crash on launch',
      createdBy: other._id, status: 'pending', severity: 'Critical',
    },
  ]);

  return { actor, other, web, mob };
}

test('resolveTicketDoc accepts a Mongo id and a human ticketId', async () => {
  await fixture();
  const byKey = await resolveTicketDoc('WEB-101');
  const byId = await resolveTicketDoc(String(byKey._id));

  assert.equal(String(byId._id), String(byKey._id));
});

test('resolveTicketDoc is case-insensitive on the human id', async () => {
  await fixture();
  assert.equal((await resolveTicketDoc('web-101')).ticketId, 'WEB-101');
});

test('resolveTicketDoc throws 404 for both forms when missing', async () => {
  await fixture();
  await assert.rejects(
    () => resolveTicketDoc('WEB-9999'),
    (err) => err.statusCode === 404 && err.code === 'TICKET_NOT_FOUND',
  );
  await assert.rejects(
    () => resolveTicketDoc(String(new mongoose.Types.ObjectId())),
    (err) => err.statusCode === 404,
  );
});

test('getTicket returns revision so the client can send it back', async () => {
  const { actor } = await fixture();
  assert.equal((await getTicket(actor, 'WEB-101')).revision, 0);
});

test('getTicket rejects a member with no relationship to the ticket', async () => {
  const { other } = await fixture();
  await assert.rejects(
    () => getTicket(other, 'WEB-101'),
    (err) => err.statusCode === 403 && err.code === 'FORBIDDEN',
  );
});

test('q matches the text index', async () => {
  const { actor } = await fixture();
  const page = await listTickets(actor, { q: 'dashboard' });
  assert.deepEqual(page.results.map((t) => t.ticketId), ['WEB-102']);
});

test('q matches an exact ticketId that no text index would find', async () => {
  const { actor } = await fixture();
  const page = await listTickets(actor, { q: 'WEB-101' });
  assert.deepEqual(page.results.map((t) => t.ticketId), ['WEB-101']);
});

test('filters compose', async () => {
  const { actor, web } = await fixture();
  const page = await listTickets(actor, {
    project: String(web._id), severity: 'Critical', status: 'pending',
  });
  assert.deepEqual(page.results.map((t) => t.ticketId), ['WEB-101']);
});

test('scope=assigned and scope=reported resolve against the actor, not the query', async () => {
  const { actor } = await fixture();

  const assigned = await listTickets(actor, { scope: 'assigned' });
  assert.deepEqual(assigned.results.map((t) => t.ticketId), ['WEB-102']);

  const reported = await listTickets(actor, { scope: 'reported' });
  assert.deepEqual(reported.results.map((t) => t.ticketId), ['WEB-101']);
});

test('scope=unassigned finds tickets with neither assignee nor team', async () => {
  const { actor } = await fixture();
  const page = await listTickets(actor, { scope: 'unassigned' });
  assert.deepEqual(page.results.map((t) => t.ticketId), ['WEB-101']);
});

test('members only see tickets they are related to', async () => {
  const { other } = await fixture();
  const page = await listTickets(other, {});
  assert.equal(page.totalResults, 2);
  assert.deepEqual(page.results.map((t) => t.ticketId).sort(), ['MOB-1', 'WEB-102']);
});

test('watchers can view and list tickets they watch', async () => {
  const { actor, other, web } = await fixture();
  await Ticket.updateOne({ ticketId: 'WEB-101' }, { $addToSet: { watchers: other._id } });

  const page = await listTickets(other, {});
  assert.ok(page.results.some((t) => t.ticketId === 'WEB-101'));
  assert.equal((await getTicket(other, 'WEB-101')).ticketId, 'WEB-101');
});

test('team members can view and list tickets assigned to their team', async () => {
  const { actor, other, web } = await fixture();
  const team = await Team.create({
    name: 'Platform', project: web._id, members: [other._id], createdBy: actor._id,
  });
  await Ticket.updateOne({ ticketId: 'WEB-101' }, { $set: { team: team._id } });

  const page = await listTickets(other, {});
  assert.ok(page.results.some((t) => t.ticketId === 'WEB-101'));
  assert.equal((await getTicket(other, 'WEB-101')).ticketId, 'WEB-101');
});

test('q matches the module field', async () => {
  const { actor, web } = await fixture();
  await Ticket.create({
    ticketId: 'WEB-201', project: web._id, title: 'Unrelated title',
    module: 'Authentication', createdBy: actor._id, status: 'pending',
  });

  const page = await listTickets(actor, { q: 'Authentication' });
  assert.deepEqual(page.results.map((t) => t.ticketId), ['WEB-201']);
});

test('overdue excludes closed and live tickets with past estimatedResolutionAt', async () => {
  const { actor, web } = await fixture();
  const past = new Date(Date.now() - 86400000);
  const future = new Date(Date.now() + 86400000);

  await Ticket.create([
    {
      ticketId: 'WEB-301', project: web._id, title: 'Overdue pending',
      createdBy: actor._id, status: 'pending', estimatedResolutionAt: past,
    },
    {
      ticketId: 'WEB-302', project: web._id, title: 'Past date but live',
      createdBy: actor._id, status: 'live', estimatedResolutionAt: past,
    },
    {
      ticketId: 'WEB-303', project: web._id, title: 'Past date but closed',
      createdBy: actor._id, status: 'closed', estimatedResolutionAt: past,
    },
    {
      ticketId: 'WEB-304', project: web._id, title: 'Future estimate',
      createdBy: actor._id, status: 'pending', estimatedResolutionAt: future,
    },
  ]);

  const page = await listTickets(actor, { overdue: true });
  assert.deepEqual(page.results.map((t) => t.ticketId), ['WEB-301']);
});

test('the list projection omits the embedded arrays', async () => {
  const { actor } = await fixture();
  const [first] = (await listTickets(actor, {})).results;

  assert.equal(first.comments, undefined);
  assert.equal(first.activityLog, undefined);
  assert.equal(first.stageHistory, undefined);
});
