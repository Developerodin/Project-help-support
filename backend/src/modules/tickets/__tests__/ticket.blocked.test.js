import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import { createTicket, setBlocked, clearBlocked, listTickets } from '../ticket.service.js';

withMemoryDb();

const user = (over = {}) => User.create({
  name: 'Ada',
  email: `${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password',
  status: 'active',
  role: 'lead',
  ...over,
});

const project = (over = {}) => Project.create({
  key: 'WEB',
  name: 'Web App',
  createdBy: new mongoose.Types.ObjectId(),
  ...over,
});

test('sets and clears blocked with a reason and revision', async () => {
  const actor = await user();
  const web = await project();
  const created = await createTicket(actor, { project: web.id, title: 'Print header vanishes' });

  const blocked = await setBlocked(actor, created.ticketId, {
    revision: created.revision,
    reason: 'Waiting on staging credentials',
  });

  assert.equal(blocked.blocked, true);
  assert.equal(blocked.blockerReason, 'Waiting on staging credentials');
  assert.ok(blocked.blockedAt);
  assert.equal(blocked.revision, created.revision + 1);

  const cleared = await clearBlocked(actor, created.ticketId, {
    revision: blocked.revision,
  });

  assert.equal(cleared.blocked, false);
  assert.equal(cleared.blockerReason, undefined);
  assert.equal(cleared.revision, blocked.revision + 1);
});

test('filters list by blocked=true', async () => {
  const actor = await user();
  const web = await project();
  const a = await createTicket(actor, { project: web.id, title: 'Blocked one' });
  await createTicket(actor, { project: web.id, title: 'Open one' });
  await setBlocked(actor, a.ticketId, {
    revision: a.revision,
    reason: 'Needs product decision',
  });

  const page = await listTickets(actor, { blocked: 'true' });
  assert.equal(page.totalResults, 1);
  assert.equal(page.results[0].ticketId, a.ticketId);
});
