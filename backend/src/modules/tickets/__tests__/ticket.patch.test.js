import test from 'node:test';
import assert from 'node:assert/strict';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import Ticket from '../ticket.model.js';
import {
  createTicket, patchTicket, assignTicket, watchTicket, unwatchTicket,
  bulkTickets, assertCanEditTicket,
} from '../ticket.service.js';

withMemoryDb();

const user = (role = 'member') => User.create({
  name: 'Person', email: `${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password', status: 'active', role,
});

async function seed() {
  const reporter = await user();
  const web = await Project.create({ key: 'WEB', name: 'Web App', createdBy: reporter._id });
  const ticket = await createTicket(reporter, { project: web.id, title: 'Broken login' });
  return { reporter, web, ticket };
}

test('a patch with the current revision succeeds and bumps it', async () => {
  const { reporter, ticket } = await seed();

  const updated = await patchTicket(reporter, ticket.id, { revision: 0, priority: 'Urgent' });

  assert.equal(updated.priority, 'Urgent');
  assert.equal(updated.revision, 1);
});

test('a patch with a stale revision returns 409 and overwrites nothing', async () => {
  const { reporter, ticket } = await seed();

  await patchTicket(reporter, ticket.id, { revision: 0, priority: 'Urgent' });

  await assert.rejects(
    () => patchTicket(reporter, ticket.id, { revision: 0, severity: 'Minor' }),
    (err) => err.statusCode === 409
      && err.code === 'STALE_REVISION'
      && err.fields.currentRevision === 1,
  );

  const stored = await Ticket.findById(ticket.id);
  assert.equal(stored.priority, 'Urgent', 'the first edit survives');
  assert.equal(stored.severity, undefined, 'the stale edit was not applied');
});

test('concurrent patches: one wins, one gets 409', async () => {
  const { reporter, ticket } = await seed();

  const results = await Promise.allSettled([
    patchTicket(reporter, ticket.id, { revision: 0, priority: 'Urgent' }),
    patchTicket(reporter, ticket.id, { revision: 0, priority: 'Low' }),
  ]);

  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);

  const [rejected] = results.filter((r) => r.status === 'rejected');
  assert.equal(rejected.reason.statusCode, 409);
});

test('a patch records an activityLog entry with before and after values', async () => {
  const { reporter, ticket } = await seed();
  await patchTicket(reporter, ticket.id, { revision: 0, priority: 'Urgent' });

  const last = (await Ticket.findById(ticket.id)).activityLog.at(-1);

  assert.equal(last.action, 'updated');
  assert.equal(last.changes.length, 1);
  assert.equal(last.changes[0].field, 'priority');
  assert.equal(last.changes[0].to, 'Urgent');
});

test('a member who is neither reporter nor assignee cannot edit', async () => {
  const { ticket } = await seed();
  const stranger = await user('member');
  const doc = await Ticket.findById(ticket.id);

  assert.throws(
    () => assertCanEditTicket(stranger, doc),
    (err) => err.statusCode === 403 && err.code === 'FORBIDDEN',
  );
});

test('a lead may edit any ticket; the assignee may edit their own', async () => {
  const { ticket } = await seed();
  const lead = await user('lead');
  const assignee = await user();

  await Ticket.updateOne({ _id: ticket.id }, { $set: { assignedTo: assignee._id } });
  const doc = await Ticket.findById(ticket.id);

  assert.doesNotThrow(() => assertCanEditTicket(lead, doc));
  assert.doesNotThrow(() => assertCanEditTicket(assignee, doc));
});

test('assign is lead/admin only', async () => {
  const { ticket } = await seed();
  const member = await user('member');
  const lead = await user('lead');

  await assert.rejects(
    () => assignTicket(member, ticket.id, { assignedTo: member._id, revision: 0 }),
    (err) => err.statusCode === 403,
  );

  const updated = await assignTicket(lead, ticket.id, { assignedTo: lead._id, revision: 0 });
  assert.equal(String(updated.assignedTo), String(lead._id));
});

test('watch and unwatch are idempotent', async () => {
  const { reporter, ticket } = await seed();

  await watchTicket(reporter, ticket.id);
  await watchTicket(reporter, ticket.id);
  assert.equal((await Ticket.findById(ticket.id)).watchers.length, 1);

  await unwatchTicket(reporter, ticket.id);
  await unwatchTicket(reporter, ticket.id);
  assert.equal((await Ticket.findById(ticket.id)).watchers.length, 0);
});

test('bulk assign authorizes per ticket and returns per-item results', async () => {
  const lead = await user('lead');
  const reporter = await user();
  const web = await Project.create({ key: 'WEB', name: 'Web App', createdBy: lead._id });

  const one = await createTicket(reporter, { project: web.id, title: 'One' });
  const two = await createTicket(reporter, { project: web.id, title: 'Two' });

  const result = await bulkTickets(lead, {
    action: 'assign',
    ids: [one.id, two.id, '507f1f77bcf86cd799439011'],
    assignedTo: lead._id,
  });

  assert.equal(result.results.length, 3);
  assert.equal(result.succeeded, 2);
  assert.equal(result.results.find((r) => !r.ok).error.code, 'TICKET_NOT_FOUND');
});

test('bulk never authorizes once and assumes the rest', async () => {
  const member = await user('member');
  const reporter = await user();
  const web = await Project.create({ key: 'WEB', name: 'Web App', createdBy: reporter._id });
  const foreign = await createTicket(reporter, { project: web.id, title: 'Not yours' });

  const result = await bulkTickets(member, {
    action: 'assign', ids: [foreign.id], assignedTo: member._id,
  });

  assert.equal(result.results[0].ok, false);
  assert.equal(result.results[0].error.code, 'FORBIDDEN');
});
