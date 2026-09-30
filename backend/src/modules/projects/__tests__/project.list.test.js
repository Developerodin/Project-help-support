import test from 'node:test';
import assert from 'node:assert/strict';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../project.model.js';
import { listProjects } from '../project.service.js';

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

test('listProjects supports search and pagination metadata', async () => {
  const actor = await actorUser();
  await Project.create([
    { key: 'WEB', name: 'Web Application', createdBy: actor._id },
    { key: 'MOB', name: 'Mobile Application', createdBy: actor._id },
    { key: 'API', name: 'Internal API', createdBy: actor._id },
  ]);

  const page = await listProjects({ search: 'web', limit: 10, page: 1 }, actor);
  assert.equal(page.totalResults, 1);
  assert.equal(page.results.length, 1);
  assert.equal(page.results[0].key, 'WEB');
  assert.equal(page.resultsTruncated, false);

  const qPage = await listProjects({ q: 'mob', limit: 1, page: 1 }, actor);
  assert.equal(qPage.totalResults, 1);
  assert.equal(qPage.results.length, 1);
  assert.equal(qPage.results[0].key, 'MOB');
});
