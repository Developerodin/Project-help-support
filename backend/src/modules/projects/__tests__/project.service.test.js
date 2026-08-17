import test from 'node:test';
import assert from 'node:assert/strict';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Team from '../../teams/team.model.js';
import Project from '../project.model.js';
import {
  createProject, updateProject, replaceModules, assertModuleAndPage, listProjects, listBrands,
  deriveProjectKeyBase,
} from '../project.service.js';

withMemoryDb();

const admin = () => User.create({
  name: 'Root', email: `root-${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password', role: 'admin', status: 'active',
});

test('deriveProjectKeyBase builds a prefix from the first word', () => {
  assert.equal(deriveProjectKeyBase('Web App'), 'WEB');
  assert.equal(deriveProjectKeyBase('Mobile App'), 'MOB');
  assert.equal(deriveProjectKeyBase('HR Portal'), 'HR');
});

test('createProject auto-generates a key when omitted', async () => {
  const actor = await admin();
  const project = await createProject(actor, { brand: 'Dharwin', name: 'Web App' });
  assert.equal(project.key, 'WEB');
});

test('createProject resolves key collisions with a numeric suffix', async () => {
  const actor = await admin();
  await createProject(actor, { brand: 'Dharwin', key: 'WEB', name: 'Web App' });
  const second = await createProject(actor, { brand: 'Dharwin', name: 'Web Portal' });
  assert.equal(second.key, 'WEB2');
});

test('createProject skips reserved auto keys', async () => {
  const actor = await admin();
  const project = await createProject(actor, { brand: 'Legacy', name: 'Dev Tools' });
  assert.equal(project.key, 'DEV2');
});

test('createProject accepts defaults and modules on create', async () => {
  const actor = await admin();
  const assignee = await User.create({
    name: 'Dev', email: 'dev@example.com', password: 'a-long-enough-password', status: 'active',
  });
  const team = await Team.create({ name: 'Platform', members: [assignee._id], createdBy: actor._id });

  const project = await createProject(actor, {
    brand: 'Dharwin',
    name: 'Analytics',
    team: team._id,
    modules: [{ label: 'Reports', pages: [{ label: 'Overview', path: '/reports' }] }],
  });

  assert.equal(project.key, 'ANA');
  assert.equal(String(project.team.id ?? project.team), String(team._id));
  assert.ok(project.teamMembers.some((m) => m.user.id === String(assignee._id)));
  assert.equal(project.modules[0].label, 'Reports');
});

test('createProject requires a brand', async () => {
  const actor = await admin();
  await assert.rejects(
    () => createProject(actor, { key: 'OPS', name: 'Operations' }),
    (err) => err.statusCode === 400 && err.code === 'BRAND_REQUIRED',
  );
});

test('listBrands returns distinct active brand names', async () => {
  const actor = await admin();
  await createProject(actor, { brand: 'Dharwin', key: 'WEB', name: 'Web App' });
  await createProject(actor, { brand: 'Dharwin', key: 'MOB', name: 'Mobile App' });
  await createProject(actor, { brand: 'Acme', key: 'ACM', name: 'Acme Portal' });

  assert.deepEqual(await listBrands(), ['Acme', 'Dharwin']);
});

test('createProject rejects a reserved key', async () => {
  const actor = await admin();
  await assert.rejects(
    () => createProject(actor, { brand: 'Legacy', key: 'DEV', name: 'Legacy' }),
    (err) => err.statusCode === 400 && err.code === 'RESERVED_PROJECT_KEY',
  );
});

test('updateProject rejects a default assignee who is not active', async () => {
  const actor = await admin();
  const project = await createProject(actor, { brand: 'Dharwin', key: 'WEB', name: 'Web App' });
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
  const web = await createProject(actor, { brand: 'Dharwin', key: 'WEB', name: 'Web App' });
  const mob = await createProject(actor, { brand: 'Dharwin', key: 'MOB', name: 'Mobile App' });
  const foreign = await Team.create({ name: 'Mobile Squad', project: mob.id, createdBy: actor._id });

  await assert.rejects(
    () => updateProject(web.id, { team: foreign._id }),
    (err) => err.statusCode === 400 && err.code === 'TEAM_PROJECT_MISMATCH',
  );
});

test('updateProject accepts a global team assignment', async () => {
  const actor = await admin();
  const web = await createProject(actor, { brand: 'Dharwin', key: 'WEB', name: 'Web App' });
  const global = await Team.create({ name: 'Platform', createdBy: actor._id });

  const updated = await updateProject(web.id, { team: global._id });
  assert.equal(String(updated.team.id ?? updated.team), String(global._id));
});

test('updateProject cannot change the key', async () => {
  const actor = await admin();
  const web = await createProject(actor, { brand: 'Dharwin', key: 'WEB', name: 'Web App' });

  await updateProject(web.id, { name: 'Web Application' });
  assert.equal((await Project.findById(web.id)).key, 'WEB');
});

test('replaceModules swaps the taxonomy wholesale', async () => {
  const actor = await admin();
  const web = await createProject(actor, { brand: 'Dharwin', key: 'WEB', name: 'Web App' });

  await replaceModules(web.id, [{ label: 'ATS', pages: [{ label: 'Jobs', path: '/jobs' }] }]);
  await replaceModules(web.id, [{ label: 'Payroll', pages: [] }]);

  const stored = await Project.findById(web.id);
  assert.equal(stored.modules.length, 1);
  assert.equal(stored.modules[0].label, 'Payroll');
});

test('assertModuleAndPage validates against the project taxonomy', async () => {
  const actor = await admin();
  const web = await createProject(actor, { brand: 'Dharwin', key: 'WEB', name: 'Web App' });
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
  await createProject(actor, { brand: 'Dharwin', key: 'WEB', name: 'Web App' });
  const mob = await createProject(actor, { brand: 'Dharwin', key: 'MOB', name: 'Mobile App' });
  await updateProject(mob.id, { status: 'archived' });

  assert.equal((await listProjects({})).results.length, 1);
  assert.equal((await listProjects({ status: 'archived' })).results.length, 1);
});
