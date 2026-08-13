import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Team from '../../teams/team.model.js';
import Project from '../../projects/project.model.js';
import Ticket from '../ticket.model.js';
import { createTicket } from '../ticket.service.js';

withMemoryDb();

const user = (over = {}) => User.create({
  name: 'Ada', email: `${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password', status: 'active', ...over,
});

const project = (over = {}) => Project.create({
  key: 'WEB', name: 'Web App', createdBy: new mongoose.Types.ObjectId(), ...over,
});

test('a created ticket lands in pending with a project-scoped id', async () => {
  const actor = await user();
  const web = await project();

  const ticket = await createTicket(actor, { project: web.id, title: 'Broken login' });

  assert.equal(ticket.ticketId, 'WEB-1');
  assert.equal(ticket.status, 'pending');
  assert.equal(ticket.revision, 0);
  assert.equal(String(ticket.createdBy), String(actor._id));
});

test('two concurrent creates produce WEB-101 and WEB-102, never a duplicate', async () => {
  const actor = await user();
  // Seeded mid-sequence so the assertion is the exact pair from the spec's
  // verification checklist rather than an approximation of it.
  const web = await project({ nextTicketSeq: 101 });

  const [a, b] = await Promise.all([
    createTicket(actor, { project: web.id, title: 'One' }),
    createTicket(actor, { project: web.id, title: 'Two' }),
  ]);

  assert.deepEqual([a.ticketId, b.ticketId].sort(), ['WEB-101', 'WEB-102']);
  assert.equal(await Ticket.countDocuments({}), 2);
});

test('twenty concurrent creates produce twenty distinct ids', async () => {
  const actor = await user();
  const web = await project();

  const created = await Promise.all(
    Array.from({ length: 20 }, (_, i) => createTicket(actor, {
      project: web.id, title: `Bug ${i}`,
    })),
  );

  assert.equal(new Set(created.map((t) => t.ticketId)).size, 20);
});

test('project defaults are applied at creation', async () => {
  const actor = await user();
  const dev = await user();
  const tester = await user();
  const web = await project();
  const team = await Team.create({ name: 'Platform', createdBy: actor._id });

  await Project.updateOne({ _id: web._id }, {
    $set: { defaultAssignee: dev._id, defaultTester: tester._id, defaultTeam: team._id },
  });

  const ticket = await createTicket(actor, { project: web.id, title: 'Broken login' });

  assert.equal(String(ticket.assignedTo), String(dev._id));
  assert.equal(String(ticket.testedBy), String(tester._id));
  assert.equal(String(ticket.team), String(team._id));
});

test('an explicit assignee beats the project default', async () => {
  const actor = await user();
  const dflt = await user();
  const chosen = await user();
  const web = await project();
  await Project.updateOne({ _id: web._id }, { $set: { defaultAssignee: dflt._id } });

  const ticket = await createTicket(actor, {
    project: web.id, title: 'Broken login', assignedTo: chosen._id,
  });

  assert.equal(String(ticket.assignedTo), String(chosen._id));
});

test('creating against an archived project is rejected', async () => {
  const actor = await user();
  const dev = await project({ key: 'DEV', status: 'archived' });

  await assert.rejects(
    () => createTicket(actor, { project: dev.id, title: 'Nope' }),
    (err) => err.statusCode === 400 && err.code === 'PROJECT_ARCHIVED',
  );
});

test('creating with a module that is not in the taxonomy is rejected', async () => {
  const actor = await user();
  const web = await project({ modules: [{ label: 'ATS', pages: [] }] });

  await assert.rejects(
    () => createTicket(actor, { project: web.id, title: 'X', module: 'Payroll' }),
    (err) => err.statusCode === 400 && err.code === 'UNKNOWN_MODULE',
  );
});

test('a rejected create does not consume a sequence number', async () => {
  const actor = await user();
  const web = await project({ modules: [{ label: 'ATS', pages: [] }] });

  await assert.rejects(() => createTicket(actor, {
    project: web.id, title: 'X', module: 'Payroll',
  }));

  const ok = await createTicket(actor, { project: web.id, title: 'Y' });
  assert.equal(ok.ticketId, 'WEB-1');
});

test('creating records a stageHistory entry for the landing stage', async () => {
  const actor = await user();
  const web = await project();

  const ticket = await createTicket(actor, { project: web.id, title: 'Broken login' });

  assert.equal(ticket.stageHistory.length, 1);
  assert.equal(ticket.stageHistory[0].from, undefined);
  assert.equal(ticket.stageHistory[0].to, 'pending');
});
