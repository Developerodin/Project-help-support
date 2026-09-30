import test from 'node:test';
import assert from 'node:assert/strict';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Team from '../../teams/team.model.js';
import Client from '../../clients/client.model.js';
import Project from '../project.model.js';
import {
  createProject, updateProject, replaceModules, assertModuleAndPage, listProjects,
  deriveProjectKeyBase,
} from '../project.service.js';

withMemoryDb();

const admin = () => User.create({
  name: 'Root', email: `root-${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password', role: 'admin', status: 'active',
});

async function company(actor, name = 'Dharwin') {
  return Client.create({ name, status: 'active', createdBy: actor._id });
}

test('deriveProjectKeyBase builds a prefix from the first word', () => {
  assert.equal(deriveProjectKeyBase('Web App'), 'WEB');
  assert.equal(deriveProjectKeyBase('Mobile App'), 'MOB');
  assert.equal(deriveProjectKeyBase('HR Portal'), 'HR');
});

test('createProject auto-generates a key when omitted', async () => {
  const actor = await admin();
  const client = await company(actor);
  const project = await createProject(actor, { clientId: client.id, name: 'Web App' });
  assert.equal(project.key, 'WEB');
});

test('createProject resolves key collisions with a numeric suffix', async () => {
  const actor = await admin();
  const client = await company(actor);
  await createProject(actor, { clientId: client.id, key: 'WEB', name: 'Web App' });
  const second = await createProject(actor, { clientId: client.id, name: 'Web Portal' });
  assert.equal(second.key, 'WEB2');
});

test('createProject skips reserved auto keys', async () => {
  const actor = await admin();
  const client = await company(actor, 'Legacy');
  const project = await createProject(actor, { clientId: client.id, name: 'Dev Tools' });
  assert.equal(project.key, 'DEV2');
});

test('createProject accepts defaults and modules on create', async () => {
  const actor = await admin();
  const client = await company(actor);
  const assignee = await User.create({
    name: 'Dev', email: 'dev@example.com', password: 'a-long-enough-password', status: 'active',
  });
  const team = await Team.create({ name: 'Platform', members: [assignee._id], createdBy: actor._id });

  const project = await createProject(actor, {
    clientId: client.id,
    name: 'Analytics',
    team: team._id,
    modules: [{ label: 'Reports', pages: [{ label: 'Overview', path: '/reports' }] }],
  });

  assert.equal(project.key, 'ANA');
  assert.equal(String(project.team.id ?? project.team), String(team._id));
  assert.ok(project.teamMembers.some((m) => m.user.id === String(assignee._id)));
  assert.equal(project.modules[0].label, 'Reports');
  assert.equal(project.client.name, 'Dharwin');
});

test('createProject requires a company', async () => {
  const actor = await admin();
  await assert.rejects(
    () => createProject(actor, { key: 'OPS', name: 'Operations' }),
    (err) => err.statusCode === 400 && err.code === 'CLIENT_REQUIRED',
  );
});

test('createProject rejects an archived company', async () => {
  const actor = await admin();
  const client = await Client.create({ name: 'Old Co', status: 'archived', createdBy: actor._id });
  await assert.rejects(
    () => createProject(actor, { clientId: client.id, name: 'Portal' }),
    (err) => err.statusCode === 400 && err.code === 'CLIENT_ARCHIVED',
  );
});

test('createProject rejects a reserved key', async () => {
  const actor = await admin();
  const client = await company(actor, 'Legacy');
  await assert.rejects(
    () => createProject(actor, { clientId: client.id, key: 'DEV', name: 'Legacy' }),
    (err) => err.statusCode === 400 && err.code === 'RESERVED_PROJECT_KEY',
  );
});

test('updateProject rejects a default assignee who is not active', async () => {
  const actor = await admin();
  const client = await company(actor);
  const project = await createProject(actor, { clientId: client.id, key: 'WEB', name: 'Web App' });
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
  const client = await company(actor);
  const web = await createProject(actor, { clientId: client.id, key: 'WEB', name: 'Web App' });
  const mob = await createProject(actor, { clientId: client.id, key: 'MOB', name: 'Mobile App' });
  const foreign = await Team.create({ name: 'Mobile Squad', project: mob.id, createdBy: actor._id });

  await assert.rejects(
    () => updateProject(web.id, { team: foreign._id }),
    (err) => err.statusCode === 400 && err.code === 'TEAM_PROJECT_MISMATCH',
  );
});

test('updateProject accepts a global team assignment', async () => {
  const actor = await admin();
  const client = await company(actor);
  const web = await createProject(actor, { clientId: client.id, key: 'WEB', name: 'Web App' });
  const global = await Team.create({ name: 'Platform', createdBy: actor._id });

  const updated = await updateProject(web.id, { team: global._id });
  assert.equal(String(updated.team.id ?? updated.team), String(global._id));
});

test('updateProject cannot change the key', async () => {
  const actor = await admin();
  const client = await company(actor);
  const web = await createProject(actor, { clientId: client.id, key: 'WEB', name: 'Web App' });

  await updateProject(web.id, { name: 'Web Application' });
  assert.equal((await Project.findById(web.id)).key, 'WEB');
});

test('replaceModules swaps the taxonomy wholesale', async () => {
  const actor = await admin();
  const client = await company(actor);
  const web = await createProject(actor, { clientId: client.id, key: 'WEB', name: 'Web App' });

  await replaceModules(web.id, [{ label: 'ATS', pages: [{ label: 'Jobs', path: '/jobs' }] }]);
  await replaceModules(web.id, [{ label: 'Payroll', pages: [] }]);

  const stored = await Project.findById(web.id);
  assert.equal(stored.modules.length, 1);
  assert.equal(stored.modules[0].label, 'Payroll');
});

test('assertModuleAndPage validates against the project taxonomy', async () => {
  const actor = await admin();
  const client = await company(actor);
  const web = await createProject(actor, { clientId: client.id, key: 'WEB', name: 'Web App' });
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
  const client = await company(actor);
  await createProject(actor, { clientId: client.id, key: 'WEB', name: 'Web App' });
  const mob = await createProject(actor, { clientId: client.id, key: 'MOB', name: 'Mobile App' });
  await updateProject(mob.id, { status: 'archived' });

  assert.equal((await listProjects({})).results.length, 1);
  assert.equal((await listProjects({ status: 'archived' })).results.length, 1);
});

test('listProjects hides projects of archived companies', async () => {
  const actor = await admin();
  const live = await company(actor, 'Dharwin');
  const gone = await company(actor, 'Test');
  await createProject(actor, { clientId: live.id, key: 'WEB', name: 'Web App' });
  await createProject(actor, { clientId: gone.id, key: 'TES', name: 'Test Web' });
  gone.status = 'archived';
  await gone.save();

  const page = await listProjects({});
  assert.deepEqual(page.results.map((p) => p.key), ['WEB']);
  assert.deepEqual((await listProjects({ status: 'active' })).results.map((p) => p.key), ['WEB']);
  // Asking for that company explicitly still returns them.
  assert.equal((await listProjects({ clientId: gone.id })).results.length, 1);
});

test('listProjects filters by clientId', async () => {
  const actor = await admin();
  const dharwin = await company(actor, 'Dharwin');
  const acme = await company(actor, 'Acme');
  await createProject(actor, { clientId: dharwin.id, key: 'WEB', name: 'Web App' });
  await createProject(actor, { clientId: acme.id, key: 'ACM', name: 'Acme Portal' });

  const page = await listProjects({ clientId: dharwin.id });
  assert.equal(page.results.length, 1);
  assert.equal(page.results[0].key, 'WEB');
});

test('replaceModules refuses a write whose read went stale (409), keeping the other edit', async () => {
  const actor = await admin();
  const client = await company(actor);
  const created = await createProject(actor, {
    clientId: client.id, key: 'RACE', name: 'Race', modules: [{ label: 'Auth', pages: [] }],
  });

  const original = Project.findOneAndUpdate;
  Project.findOneAndUpdate = async function interleaved(...args) {
    Project.findOneAndUpdate = original;
    // Someone else's save lands between replaceModules' read and write.
    const other = await Project.findById(created.id);
    other.name = 'Renamed';
    await other.save();
    return original.apply(this, args);
  };
  try {
    await assert.rejects(
      replaceModules(created.id, [{ label: 'Billing', pages: [] }]),
      (err) => err.statusCode === 409,
    );
  } finally {
    Project.findOneAndUpdate = original;
  }
  const stored = await Project.findById(created.id).lean();
  assert.equal(stored.name, 'Renamed');
  assert.deepEqual(stored.modules.map((m) => m.label), ['Auth']);
});

test('two project saves from the same read: the second is a VersionError', async () => {
  const actor = await admin();
  const client = await company(actor);
  const created = await createProject(actor, { clientId: client.id, key: 'VER', name: 'Ver' });
  const a = await Project.findById(created.id);
  const b = await Project.findById(created.id);
  a.name = 'A';
  await a.save();
  b.name = 'B';
  await assert.rejects(b.save(), (err) => err.name === 'VersionError');
});

test('the project list omits UI-QA threads but keeps module and page names', async () => {
  const actor = await admin();
  const client = await company(actor);
  const created = await createProject(actor, {
    clientId: client.id, key: 'SLIM', name: 'Slim', modules: [{ label: 'Auth', pages: [{ label: 'Login' }] }],
  });
  await Project.updateOne({ _id: created.id }, {
    $push: { 'modules.0.comments': { content: 'heavy', commentedBy: actor._id } },
  });
  const page = await listProjects({}, null);
  const row = page.results.find((p) => p.key === 'SLIM');
  assert.equal(row.modules[0].label, 'Auth');
  assert.equal(row.modules[0].pages[0].label, 'Login');
  assert.ok(!row.modules[0].comments?.length);
});
