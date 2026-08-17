import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import Team from '../team.model.js';
import Ticket from '../../tickets/ticket.model.js';
import {
  isTeamUsableOnProject, assertTeamUsable, createTeam, updateMembers, listTeams,
} from '../team.service.js';

withMemoryDb();

const admin = () => User.create({
  name: 'Root', email: `root-${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password', role: 'admin', status: 'active',
});

const project = (key = 'WEB') => Project.create({
  key, name: `${key} App`, createdBy: new mongoose.Types.ObjectId(),
});

test('a global team is usable on any project', async () => {
  const web = await project('WEB');
  const team = await Team.create({ name: 'Platform', createdBy: (await admin())._id });

  assert.equal(team.project, null);
  assert.equal(isTeamUsableOnProject(team, web._id), true);
});

test('a project-scoped team is usable only on its own project', async () => {
  const web = await project('WEB');
  const mob = await project('MOB');
  const team = await Team.create({
    name: 'Web Squad', project: web._id, createdBy: (await admin())._id,
  });

  assert.equal(isTeamUsableOnProject(team, web._id), true);
  assert.equal(isTeamUsableOnProject(team, mob._id), false);
});

test('assertTeamUsable throws 400 for a foreign project', async () => {
  const web = await project('WEB');
  const mob = await project('MOB');
  const team = await Team.create({
    name: 'Web Squad', project: web._id, createdBy: (await admin())._id,
  });

  await assert.rejects(
    () => assertTeamUsable(team._id, mob._id),
    (err) => err.statusCode === 400 && err.code === 'TEAM_PROJECT_MISMATCH',
  );
});

test('assertTeamUsable throws 404 for a missing team', async () => {
  const web = await project('WEB');
  await assert.rejects(
    () => assertTeamUsable(new mongoose.Types.ObjectId(), web._id),
    (err) => err.statusCode === 404 && err.code === 'TEAM_NOT_FOUND',
  );
});

test('createTeam rejects a lead who is not an active user', async () => {
  const actor = await admin();
  const invited = await User.create({
    name: 'Pending', email: 'pending@example.com', password: 'a-long-enough-password',
    status: 'invited',
  });

  await assert.rejects(
    () => createTeam(actor, { name: 'Squad', lead: invited._id }),
    (err) => err.statusCode === 400 && err.code === 'INACTIVE_USER_REFERENCE',
  );
});

test('updateMembers adds and removes without duplicating', async () => {
  const actor = await admin();
  const one = await User.create({
    name: 'One', email: 'one@example.com', password: 'a-long-enough-password', status: 'active',
  });
  const team = await createTeam(actor, { name: 'Squad' });

  await updateMembers(team.id, { add: [one._id, one._id] });
  assert.equal((await Team.findById(team.id)).members.length, 1);

  await updateMembers(team.id, { remove: [one._id] });
  assert.equal((await Team.findById(team.id)).members.length, 0);
});

test('listTeams filters by project and returns global teams too', async () => {
  const actor = await admin();
  const web = await project('WEB');
  await createTeam(actor, { name: 'Global' });
  await createTeam(actor, { name: 'Web Only', project: web._id });

  const page = await listTeams({ project: String(web._id) });
  const names = page.results.map((t) => t.name).sort();
  assert.deepEqual(names, ['Global', 'Web Only']);
});

const DAY = 24 * 60 * 60 * 1000;

test('listTeams counts open and overdue tickets per team', async () => {
  const actor = await admin();
  const web = await project('WEB');
  const owner = await createTeam(actor, { name: 'Owner' });
  await createTeam(actor, { name: 'Idle' });

  const past = new Date(Date.now() - DAY);
  const future = new Date(Date.now() + DAY);
  const ticket = (seq, status, estimatedResolutionAt) => Ticket.create({
    ticketId: `WEB-${seq}`, project: web._id, title: `T${seq}`,
    team: owner.id, status, estimatedResolutionAt, createdBy: actor._id,
  });

  await ticket(1, 'pending', past); // overdue
  await ticket(2, 'in_progress', past); // overdue
  await ticket(3, 'pending', future); // open, on time
  await ticket(4, 'pending', undefined); // no estimate — must NOT read as overdue
  await ticket(5, 'live', past); // shipped, past estimate: not overdue
  await ticket(6, 'closed', past); // closed: neither open nor overdue

  const page = await listTeams();
  const byName = Object.fromEntries(page.results.map((t) => [t.name, t.stats]));
  assert.deepEqual(byName.Owner, { total: 6, open: 5, overdue: 2 });
  assert.deepEqual(byName.Idle, { total: 0, open: 0, overdue: 0 });
});
