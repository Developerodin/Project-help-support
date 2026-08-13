import test from 'node:test';
import assert from 'node:assert/strict';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Team from '../../teams/team.model.js';
import Project from '../project.model.js';
import {
  createProject, updateProject, replaceModules, assertModuleAndPage, listProjects,
} from '../project.service.js';

withMemoryDb();

const admin = () => User.create({
  name: 'Root', email: `root-${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password', role: 'admin', status: 'active',
});

test('createProject rejects a reserved key', async () => {
  const actor = await admin();
  await assert.rejects(
    () => createProject(actor, { key: 'DEV', name: 'Legacy' }),
    (err) => err.statusCode === 400 && err.code === 'RESERVED_PROJECT_KEY',
  );
});

test('updateProject rejects a default assignee who is not active', async () => {
  const actor = await admin();
  const project = await createProject(actor, { key: 'WEB', name: 'Web App' });
  const inactive = await User.create({
    name: 'Gone', email: 'gone@example.com', password: 'a-long-enough-password',
    status: 'inactive',
  });

  await assert.rejects(
    () => updateProject(project.id, { defaultAssignee: inactive._id }),
    (err) => err.statusCode === 400 && err.code === 'INACTIVE_USER_REFERENCE',
  );
});

test('updateProject rejects a default team belonging to another project', async () => {
  const actor = await admin();
  const web = await createProject(actor, { key: 'WEB', name: 'Web App' });
  const mob = await createProject(actor, { key: 'MOB', name: 'Mobile App' });
  const foreign = await Team.create({ name: 'Mobile Squad', project: mob.id, createdBy: actor._id });

  await assert.rejects(
    () => updateProject(web.id, { defaultTeam: foreign._id }),
    (err) => err.statusCode === 400 && err.code === 'TEAM_PROJECT_MISMATCH',
  );
});

test('updateProject accepts a global team as a default', async () => {
  const actor = await admin();
  const web = await createProject(actor, { key: 'WEB', name: 'Web App' });
  const global = await Team.create({ name: 'Platform', createdBy: actor._id });

  const updated = await updateProject(web.id, { defaultTeam: global._id });
  assert.equal(String(updated.defaultTeam.id ?? updated.defaultTeam), String(global._id));
});

test('updateProject cannot change the key', async () => {
  const actor = await admin();
  const web = await createProject(actor, { key: 'WEB', name: 'Web App' });

  await updateProject(web.id, { name: 'Web Application' });
  assert.equal((await Project.findById(web.id)).key, 'WEB');
});

test('replaceModules swaps the taxonomy wholesale', async () => {
  const actor = await admin();
  const web = await createProject(actor, { key: 'WEB', name: 'Web App' });

  await replaceModules(web.id, [{ label: 'ATS', pages: [{ label: 'Jobs', path: '/jobs' }] }]);
  await replaceModules(web.id, [{ label: 'Payroll', pages: [] }]);

  const stored = await Project.findById(web.id);
  assert.equal(stored.modules.length, 1);
  assert.equal(stored.modules[0].label, 'Payroll');
});

test('assertModuleAndPage validates against the project taxonomy', async () => {
  const actor = await admin();
  const web = await createProject(actor, { key: 'WEB', name: 'Web App' });
  await replaceModules(web.id, [{ label: 'ATS', pages: [{ label: 'Jobs', path: '/jobs' }] }]);
  const project = await Project.findById(web.id);

  assert.doesNotThrow(() => assertModuleAndPage(project, 'ATS', 'Jobs'));
  assert.doesNotThrow(() => assertModuleAndPage(project, undefined, undefined));
  assert.throws(
    () => assertModuleAndPage(project, 'Payroll', undefined),
    (err) => err.statusCode === 400 && err.code === 'UNKNOWN_MODULE',
  );
  assert.throws(
    () => assertModuleAndPage(project, 'ATS', 'Candidates'),
    (err) => err.statusCode === 400 && err.code === 'UNKNOWN_PAGE',
  );
  assert.throws(
    () => assertModuleAndPage(project, undefined, 'Jobs'),
    (err) => err.statusCode === 400 && err.code === 'PAGE_WITHOUT_MODULE',
  );
});

test('listProjects hides archived projects unless asked', async () => {
  const actor = await admin();
  await createProject(actor, { key: 'WEB', name: 'Web App' });
  const mob = await createProject(actor, { key: 'MOB', name: 'Mobile App' });
  await updateProject(mob.id, { status: 'archived' });

  assert.equal((await listProjects({})).results.length, 1);
  assert.equal((await listProjects({ status: 'archived' })).results.length, 1);
});
