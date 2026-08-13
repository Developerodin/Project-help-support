import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { WEB_MODULE_TAXONOMY } from '@pms/shared';
import { withMemoryDb } from '../platform/__tests__/helpers/memoryDb.js';
import Project from '../modules/projects/project.model.js';
import User from '../modules/users/user.model.js';
import { seedProjects } from '../seed.js';

withMemoryDb();

test('seedProjects backfills empty WEB modules from shared catalog', async () => {
  const actor = await User.create({
    name: 'Admin',
    email: 'admin@example.com',
    password: 'a-long-enough-password',
    role: 'admin',
    status: 'active',
  });

  await Project.create({
    key: 'WEB',
    name: 'Web App',
    modules: [],
    createdBy: actor._id,
  });

  await Project.create([
    {
      key: 'MOB',
      name: 'Mobile App',
      modules: [],
      createdBy: actor._id,
    },
    {
      key: 'DEV',
      name: 'Legacy Dev Tickets',
      status: 'archived',
      modules: [],
      createdBy: actor._id,
    },
  ]);

  const result = await seedProjects(actor);
  assert.deepEqual(result.backfilled, ['WEB']);

  const web = await Project.findOne({ key: 'WEB' });
  assert.equal(web.modules.length, WEB_MODULE_TAXONOMY.length);
  assert.equal(web.modules[1].label, 'ATS');
  assert.ok(web.modules[1].pages.some((p) => p.label === 'Jobs'));
});
