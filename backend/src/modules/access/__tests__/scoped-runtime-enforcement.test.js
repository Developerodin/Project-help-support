import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { ROLE_IDS } from '@pms/shared';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Client from '../../clients/client.model.js';
import Project from '../../projects/project.model.js';
import Ticket from '../../tickets/ticket.model.js';
import { createScopedAssignment } from '../scoped-access.service.js';
import { loadPermissionContextForUser } from '../../rbac/rbac.service.js';
import { updateProject, getProject } from '../../projects/project.service.js';
import { patchTicket, getTicket } from '../../tickets/ticket.service.js';
import { ApiError } from '../../../platform/errors.js';

withMemoryDb();

async function createUser({ email, roles, password = 'password123' }) {
  return User.create({
    name: email.split('@')[0],
    email,
    password,
    roles,
    role: roles[0],
    status: 'active',
  });
}

async function seedClientProject(actor, suffix = '') {
  const client = await Client.create({
    name: suffix ? `Acme-${suffix}` : 'Acme',
    status: 'active',
    createdBy: actor._id,
  });
  const project = await Project.create({
    key: suffix ? `ACME${suffix}` : 'ACME',
    name: 'Portal',
    client: client._id,
    status: 'active',
    createdBy: actor._id,
  });
  return { client, project };
}

test('scoped project_admin cannot update project outside delegated scope', async () => {
  const admin = await createUser({ email: 'admin-runtime@example.com', roles: [ROLE_IDS.ADMIN] });
  const projectAdmin = await createUser({ email: 'pa-runtime@example.com', roles: [ROLE_IDS.PROJECT_ADMIN] });
  const scopeA = await seedClientProject(admin, 'A');
  const scopeB = await seedClientProject(admin, 'B');

  await createScopedAssignment(admin, projectAdmin._id, {
    role: ROLE_IDS.PROJECT_ADMIN,
    clientId: scopeA.client._id,
    projectId: scopeA.project._id,
    environments: ['Staging'],
    reason: 'Scoped admin A',
  });

  const context = await loadPermissionContextForUser(projectAdmin._id);

  await updateProject(
    scopeA.project._id,
    { description: 'Allowed update' },
    projectAdmin,
    context,
  );

  await assert.rejects(
    () => updateProject(
      scopeB.project._id,
      { description: 'Blocked update' },
      projectAdmin,
      context,
    ),
    (err) => err instanceof ApiError && err.code === 'FORBIDDEN',
  );
});

test('scoped project_admin cannot read project outside delegated scope', async () => {
  const admin = await createUser({ email: 'admin-runtime-read@example.com', roles: [ROLE_IDS.ADMIN] });
  const projectAdmin = await createUser({ email: 'pa-runtime-read@example.com', roles: [ROLE_IDS.PROJECT_ADMIN] });
  const scopeA = await seedClientProject(admin, 'A');
  const scopeB = await seedClientProject(admin, 'B');

  await createScopedAssignment(admin, projectAdmin._id, {
    role: ROLE_IDS.PROJECT_ADMIN,
    clientId: scopeA.client._id,
    projectId: scopeA.project._id,
    environments: ['Staging'],
    reason: 'Scoped admin A',
  });

  const context = await loadPermissionContextForUser(projectAdmin._id);
  await getProject(scopeA.project._id, projectAdmin, context);

  await assert.rejects(
    () => getProject(scopeB.project._id, projectAdmin, context),
    (err) => err instanceof ApiError && err.code === 'FORBIDDEN',
  );
});

test('scoped developer cannot patch ticket outside delegated scope', async () => {
  const admin = await createUser({ email: 'admin-runtime-ticket@example.com', roles: [ROLE_IDS.ADMIN] });
  const developer = await createUser({ email: 'dev-runtime@example.com', roles: [ROLE_IDS.DEVELOPER] });
  const scopeA = await seedClientProject(admin, 'A');
  const scopeB = await seedClientProject(admin, 'B');

  await createScopedAssignment(admin, developer._id, {
    role: ROLE_IDS.DEVELOPER,
    clientId: scopeA.client._id,
    projectId: scopeA.project._id,
    environments: ['Staging'],
    reason: 'Scoped dev A',
  });

  const ticketA = await Ticket.create({
    ticketId: 'A-1',
    project: scopeA.project._id,
    title: 'In scope',
    description: 'Ticket in scoped project',
    severity: 'Minor',
    priority: 'Low',
    status: 'pending',
    createdBy: admin._id,
  });
  const ticketB = await Ticket.create({
    ticketId: 'B-1',
    project: scopeB.project._id,
    title: 'Out of scope',
    description: 'Ticket outside scoped project',
    severity: 'Minor',
    priority: 'Low',
    status: 'pending',
    createdBy: admin._id,
  });

  const context = await loadPermissionContextForUser(developer._id);
  await patchTicket(developer, ticketA._id, { revision: 0, title: 'Updated in scope' }, context);

  await assert.rejects(
    () => patchTicket(developer, ticketB._id, { revision: 0, title: 'Blocked' }, context),
    (err) => err instanceof ApiError && err.code === 'FORBIDDEN',
  );

  await assert.rejects(
    () => getTicket(developer, ticketB._id, context),
    (err) => err instanceof ApiError && err.code === 'FORBIDDEN',
  );
});
