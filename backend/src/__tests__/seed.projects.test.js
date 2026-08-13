import test from 'node:test';
import assert from 'node:assert/strict';
import { withMemoryDb } from '../platform/__tests__/helpers/memoryDb.js';
import User from '../modules/users/user.model.js';
import Project from '../modules/projects/project.model.js';
import { seedProjects } from '../seed.js';

withMemoryDb();

const admin = () => User.create({
  name: 'Root', email: 'root@example.com', password: 'a-long-enough-password',
  role: 'admin', status: 'active',
});

test('seeds WEB, MOB and the reserved DEV project', async () => {
  const actor = await admin();
  const result = await seedProjects(actor);

  assert.deepEqual([...result.created].sort(), ['DEV', 'MOB', 'WEB']);

  const keys = (await Project.find({}).sort({ key: 1 })).map((p) => p.key);
  assert.deepEqual(keys, ['DEV', 'MOB', 'WEB']);
});

test('MOB seeds with an empty module taxonomy and WEB seeds a populated one', async () => {
  const actor = await admin();
  await seedProjects(actor);

  assert.deepEqual((await Project.findOne({ key: 'MOB' })).modules.toObject(), []);
  assert.ok((await Project.findOne({ key: 'WEB' })).modules.length > 0);
});

test('the DEV project is archived so it never appears in a create form', async () => {
  const actor = await admin();
  await seedProjects(actor);

  assert.equal((await Project.findOne({ key: 'DEV' })).status, 'archived');
});

test('re-running the seed changes nothing', async () => {
  const actor = await admin();
  await seedProjects(actor);
  const second = await seedProjects(actor);

  assert.deepEqual(second.created, []);
  assert.equal(await Project.countDocuments({}), 3);
});
