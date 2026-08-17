import test from 'node:test';
import assert from 'node:assert/strict';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Client from '../client.model.js';
import Project from '../../projects/project.model.js';
import {
  createClient, listClients, getClient, updateClient,
} from '../client.service.js';

withMemoryDb();

const admin = () => User.create({
  name: 'Root', email: `root-${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password', role: 'admin', status: 'active',
});

const config = { features: { attachments: false } };

test('createClient creates an active company', async () => {
  const actor = await admin();
  const client = await createClient(actor, { name: 'Dharwin' }, config);
  assert.equal(client.name, 'Dharwin');
  assert.equal(client.status, 'active');
  assert.equal(client.projectCount, 0);
});

test('createClient rejects duplicate active names', async () => {
  const actor = await admin();
  await createClient(actor, { name: 'Acme' }, config);
  await assert.rejects(
    () => createClient(actor, { name: 'Acme' }, config),
    (err) => err.statusCode === 409 && err.code === 'CLIENT_NAME_TAKEN',
  );
});

test('updateClient archives without deleting projects', async () => {
  const actor = await admin();
  const client = await createClient(actor, { name: 'Dharwin' }, config);
  await Project.create({
    key: 'WEB', name: 'Web App', client: client.id, createdBy: actor._id,
  });

  const updated = await updateClient(client.id, { status: 'archived' }, config);
  assert.equal(updated.status, 'archived');
  assert.equal(await Project.countDocuments({ client: client.id }), 1);
});

test('listClients includes project counts', async () => {
  const actor = await admin();
  const client = await createClient(actor, { name: 'Dharwin' }, config);
  await Project.create({
    key: 'WEB', name: 'Web App', client: client.id, createdBy: actor._id, status: 'active',
  });
  await Project.create({
    key: 'MOB', name: 'Mobile App', client: client.id, createdBy: actor._id, status: 'active',
  });

  const page = await listClients({}, config);
  const row = page.results.find((c) => c.id === client.id);
  assert.equal(row.projectCount, 2);
});

test('getClient returns a single company', async () => {
  const actor = await admin();
  const created = await createClient(actor, { name: 'Acme' }, config);
  const fetched = await getClient(created.id, config);
  assert.equal(fetched.name, 'Acme');
});
