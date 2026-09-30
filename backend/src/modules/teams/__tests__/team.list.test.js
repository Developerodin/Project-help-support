import test from 'node:test';
import assert from 'node:assert/strict';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Team from '../team.model.js';
import { listTeams } from '../team.service.js';

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

test('listTeams defaults to active status and supports search', async () => {
  const actor = await actorUser();
  await Team.create([
    { name: 'Platform Team', createdBy: actor._id, status: 'active' },
    { name: 'Design Squad', createdBy: actor._id, status: 'active' },
    { name: 'Old Group', createdBy: actor._id, status: 'archived' },
  ]);

  const activePage = await listTeams({}, actor);
  assert.equal(activePage.totalResults, 2);

  const searchPage = await listTeams({ search: 'platform', limit: 10, page: 1 }, actor);
  assert.equal(searchPage.totalResults, 1);
  assert.equal(searchPage.results[0].name, 'Platform Team');
  assert.equal(searchPage.resultsTruncated, false);

  const qPage = await listTeams({ q: 'design', limit: 1, page: 1 }, actor);
  assert.equal(qPage.totalResults, 1);
  assert.equal(qPage.results.length, 1);

  const archivedPage = await listTeams({ status: 'archived' }, actor);
  assert.equal(archivedPage.totalResults, 1);
  assert.equal(archivedPage.results[0].name, 'Old Group');
});

test('listTeams scope and member filters', async () => {
  const actor = await actorUser();
  const member = await User.create({
    name: 'Riley',
    email: `${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-long-enough-password',
    status: 'active',
    role: 'developer',
  });

  await Team.create([
    { name: 'Global Empty', createdBy: actor._id, members: [] },
    { name: 'Global Busy', createdBy: actor._id, members: [member._id] },
  ]);

  const emptyPage = await listTeams({ scope: 'empty' }, actor);
  assert.equal(emptyPage.totalResults, 1);
  assert.equal(emptyPage.results[0].name, 'Global Empty');

  const memberPage = await listTeams({ member: String(member._id) }, actor);
  assert.equal(memberPage.totalResults, 1);
  assert.equal(memberPage.results[0].name, 'Global Busy');
});
