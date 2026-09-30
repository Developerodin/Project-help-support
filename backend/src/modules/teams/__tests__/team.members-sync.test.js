import test from 'node:test';
import assert from 'node:assert/strict';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import ProjectTeamMember from '../../projects/project-team-member.model.js';
import Team from '../team.model.js';
import { updateMembers } from '../team.service.js';

withMemoryDb();

async function actorUser() {
  return User.create({
    name: 'Admin',
    email: `${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-long-enough-password',
    status: 'active',
    role: 'admin',
  });
}

async function memberUser(label) {
  return User.create({
    name: label,
    email: `${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-long-enough-password',
    status: 'active',
    role: 'developer',
  });
}

test('updateMembers syncs ProjectTeamMember for linked projects', async () => {
  const actor = await actorUser();
  const alice = await memberUser('Alice');
  const bob = await memberUser('Bob');

  const team = await Team.create({
    name: 'Delivery',
    createdBy: actor._id,
    members: [alice._id],
  });

  const project = await Project.create({
    key: 'WEB',
    name: 'Web App',
    createdBy: actor._id,
    team: team._id,
  });

  await ProjectTeamMember.create({
    project: project._id,
    team: team._id,
    user: alice._id,
    role: 'member',
  });

  await updateMembers(String(team._id), { add: [String(bob._id)] }, actor);

  const rows = await ProjectTeamMember.find({ project: project._id }).lean();
  assert.equal(rows.length, 2);
  const userIds = rows.map((row) => String(row.user)).sort();
  assert.deepEqual(userIds, [String(alice._id), String(bob._id)].sort());

  await updateMembers(String(team._id), { remove: [String(alice._id)] }, actor);

  const afterRemove = await ProjectTeamMember.find({ project: project._id }).lean();
  assert.equal(afterRemove.length, 1);
  assert.equal(String(afterRemove[0].user), String(bob._id));
});
