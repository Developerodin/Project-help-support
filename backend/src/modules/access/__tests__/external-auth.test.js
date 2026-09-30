import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { ROLE_IDS } from '@pms/shared';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Client from '../../clients/client.model.js';
import Project from '../../projects/project.model.js';
import Ticket from '../../tickets/ticket.model.js';
import AccessAssignment from '../accessAssignment.model.js';
import {
  buildExternalTicketFilter,
  canExternalViewTicket,
  permittedProjectIdsForExternalUser,
  permittedClientIdsForExternalUser,
  hasExternalWorkspaceAccess,
  externalUserCoversProject,
  activeAssignmentsForUser,
  syncCompanyExternalAccess,
  sanitizeExternalTicket,
  revokeProjectExternalAssignmentsOnClientChange,
  COMPANY_WIDE_AUTO_ASSIGN_REASON,
} from '../external-auth.service.js';
import { listProjects, getProject, createProject } from '../../projects/project.service.js';
import { listClients } from '../../clients/client.service.js';
import { listTickets, getTicket, createTicket, watchTicket, unwatchTicket } from '../../tickets/ticket.service.js';
import { listNotifications } from '../../notifications/notification.service.js';
import Notification from '../../notifications/notification.model.js';

withMemoryDb();

const password = 'a-long-enough-password';

async function user(role, emailSuffix = Math.random().toString(36).slice(2)) {
  return User.create({
    name: role,
    email: `${role}-${emailSuffix}@example.com`,
    password,
    role,
    status: 'active',
  });
}

async function seedCompanies() {
  const admin = await user(ROLE_IDS.ADMIN);
  const companyA = await Client.create({ name: 'Company A', status: 'active', createdBy: admin._id });
  const companyB = await Client.create({ name: 'Company B', status: 'active', createdBy: admin._id });

  const projectA1 = await Project.create({
    key: 'A1', name: 'A One', client: companyA._id, createdBy: admin._id,
  });
  const projectA2 = await Project.create({
    key: 'A2', name: 'A Two', client: companyA._id, createdBy: admin._id,
  });
  const projectB1 = await Project.create({
    key: 'B1', name: 'B One', client: companyB._id, createdBy: admin._id,
  });

  return { admin, companyA, companyB, projectA1, projectA2, projectB1 };
}

/** Assert GET /projects, permittedProjectIds, and ticket filter share the same scope. */
async function assertExternalScopeConsistent(actor) {
  const permitted = [...(await permittedProjectIdsForExternalUser(actor._id))].sort();
  const projectIds = (await listProjects({}, actor)).results.map((p) => p.id).sort();
  assert.deepEqual(projectIds, permitted);

  const ticketFilter = await buildExternalTicketFilter(actor);
  if (!permitted.length) {
    assert.deepEqual(ticketFilter, { _id: null });
    return permitted;
  }
  assert.deepEqual([...ticketFilter.project.$in].sort(), permitted);
  return permitted;
}

test('company-wide client_tester sees all tickets in company projects', async () => {
  const { admin, companyA, projectA1, projectA2 } = await seedCompanies();
  const tester = await user(ROLE_IDS.CLIENT_TESTER);
  const otherTester = await user(ROLE_IDS.CLIENT_TESTER);
  const developer = await user(ROLE_IDS.DEVELOPER);

  await AccessAssignment.create({
    user: tester._id,
    role: ROLE_IDS.CLIENT_TESTER,
    client: companyA._id,
    project: null,
    grantedBy: admin._id,
  });
  await AccessAssignment.create({
    user: otherTester._id,
    role: ROLE_IDS.CLIENT_TESTER,
    client: companyA._id,
    project: null,
    grantedBy: admin._id,
  });

  await Ticket.create([
    {
      ticketId: 'A1-1', project: projectA1._id, title: 'Mine', createdBy: tester._id,
      severity: 'Minor', priority: 'Low', status: 'pending',
    },
    {
      ticketId: 'A1-2', project: projectA1._id, title: 'Other tester', createdBy: otherTester._id,
      severity: 'Minor', priority: 'Low', status: 'pending',
    },
    {
      ticketId: 'A2-1', project: projectA2._id, title: 'Internal', createdBy: developer._id,
      severity: 'Minor', priority: 'Low', status: 'pending',
    },
  ]);

  const page = await listTickets(tester, {});
  assert.deepEqual(page.results.map((t) => t.ticketId).sort(), ['A1-1', 'A1-2', 'A2-1']);
  assert.equal((await getTicket(tester, 'A1-2')).ticketId, 'A1-2');
  assert.equal((await getTicket(tester, 'A2-1')).ticketId, 'A2-1');
});

test('project-scoped client_tester sees all tickets in assigned project only', async () => {
  const { admin, companyA, projectA1, projectA2 } = await seedCompanies();
  const tester = await user(ROLE_IDS.CLIENT_TESTER);
  const developer = await user(ROLE_IDS.DEVELOPER);

  await AccessAssignment.create({
    user: tester._id,
    role: ROLE_IDS.CLIENT_TESTER,
    client: companyA._id,
    project: projectA1._id,
    grantedBy: admin._id,
  });

  await Ticket.create([
    {
      ticketId: 'A1-3', project: projectA1._id, title: 'Allowed', createdBy: tester._id,
      severity: 'Minor', priority: 'Low', status: 'pending',
    },
    {
      ticketId: 'A1-3b', project: projectA1._id, title: 'Internal in scope', createdBy: developer._id,
      severity: 'Minor', priority: 'Low', status: 'pending',
    },
    {
      ticketId: 'A2-2', project: projectA2._id, title: 'Other project', createdBy: tester._id,
      severity: 'Minor', priority: 'Low', status: 'pending',
    },
  ]);

  const permitted = await permittedProjectIdsForExternalUser(tester._id);
  assert.deepEqual(permitted.sort(), [String(projectA1._id)]);

  const projects = await listProjects({}, tester);
  assert.equal(projects.results.length, 1);
  assert.equal(projects.results[0].key, 'A1');

  const page = await listTickets(tester, {});
  assert.deepEqual(page.results.map((t) => t.ticketId).sort(), ['A1-3', 'A1-3b']);
  await assert.rejects(() => getTicket(tester, 'A2-2'), (err) => err.statusCode === 403);
});

test('client sees all tickets in assigned company projects', async () => {
  const { admin, companyA, projectA1 } = await seedCompanies();
  const clientUser = await user(ROLE_IDS.CLIENT);
  const tester = await user(ROLE_IDS.CLIENT_TESTER);
  const developer = await user(ROLE_IDS.DEVELOPER);

  await AccessAssignment.create({
    user: clientUser._id,
    role: ROLE_IDS.CLIENT,
    client: companyA._id,
    project: null,
    grantedBy: admin._id,
  });
  await AccessAssignment.create({
    user: tester._id,
    role: ROLE_IDS.CLIENT_TESTER,
    client: companyA._id,
    project: null,
    grantedBy: admin._id,
  });

  await Ticket.create([
    {
      ticketId: 'A1-4', project: projectA1._id, title: 'External', createdBy: tester._id,
      severity: 'Minor', priority: 'Low', status: 'pending',
    },
    {
      ticketId: 'A1-5', project: projectA1._id, title: 'Internal', createdBy: developer._id,
      severity: 'Minor', priority: 'Low', status: 'pending',
    },
    {
      ticketId: 'A1-6', project: projectA1._id, title: 'Raised by the client', createdBy: clientUser._id,
      severity: 'Minor', priority: 'Low', status: 'pending',
    },
  ]);

  const page = await listTickets(clientUser, {});
  assert.deepEqual(page.results.map((t) => t.ticketId).sort(), ['A1-4', 'A1-5', 'A1-6']);
  assert.equal((await getTicket(clientUser, 'A1-5')).ticketId, 'A1-5');
  assert.equal((await getTicket(clientUser, 'A1-6')).ticketId, 'A1-6');
});

test('cross-company isolation for external users', async () => {
  const { admin, companyA, companyB, projectA1, projectB1 } = await seedCompanies();
  const testerA = await user(ROLE_IDS.CLIENT_TESTER);
  const testerB = await user(ROLE_IDS.CLIENT_TESTER);

  await AccessAssignment.create({
    user: testerA._id,
    role: ROLE_IDS.CLIENT_TESTER,
    client: companyA._id,
    project: null,
    grantedBy: admin._id,
  });
  await AccessAssignment.create({
    user: testerB._id,
    role: ROLE_IDS.CLIENT_TESTER,
    client: companyB._id,
    project: null,
    grantedBy: admin._id,
  });

  await Ticket.create([
    {
      ticketId: 'A1-6', project: projectA1._id, title: 'A ticket', createdBy: testerA._id,
      severity: 'Minor', priority: 'Low', status: 'pending',
    },
    {
      ticketId: 'B1-1', project: projectB1._id, title: 'B ticket', createdBy: testerB._id,
      severity: 'Minor', priority: 'Low', status: 'pending',
    },
  ]);

  const pageA = await listTickets(testerA, {});
  assert.deepEqual(pageA.results.map((t) => t.ticketId), ['A1-6']);
  await assert.rejects(() => getTicket(testerA, 'B1-1'), (err) => err.statusCode === 403);
});

test('syncCompanyExternalAccess stores assignments only on AccessAssignment', async () => {
  const admin = await user(ROLE_IDS.ADMIN);
  const company = await Client.create({ name: 'Sync Co', status: 'active', createdBy: admin._id });
  const clientUser = await user(ROLE_IDS.CLIENT);
  const tester = await user(ROLE_IDS.CLIENT_TESTER);

  const access = await syncCompanyExternalAccess(admin, company._id, {
    clientUserIds: [String(clientUser._id)],
    clientTesterIds: [String(tester._id)],
  });

  assert.deepEqual(access.clientUserIds, [String(clientUser._id)]);
  assert.deepEqual(access.clientTesterIds, [String(tester._id)]);
  assert.equal(await AccessAssignment.countDocuments({ client: company._id, status: 'active' }), 2);
});

test('buildExternalTicketFilter returns empty match without assignments', async () => {
  const tester = await user(ROLE_IDS.CLIENT_TESTER);
  const filter = await buildExternalTicketFilter(tester);
  assert.deepEqual(filter, { _id: null });
});

test('client with company A assignment sees all A tickets, not company B', async () => {
  const { admin, companyA, companyB, projectA1, projectB1 } = await seedCompanies();
  const clientUser = await user(ROLE_IDS.CLIENT);
  const developer = await user(ROLE_IDS.DEVELOPER);

  await AccessAssignment.create({
    user: clientUser._id,
    role: ROLE_IDS.CLIENT,
    client: companyA._id,
    project: null,
    grantedBy: admin._id,
  });

  await Ticket.create([
    {
      ticketId: 'A1-REG1', project: projectA1._id, title: 'Company A internal',
      createdBy: developer._id, severity: 'Minor', priority: 'Low', status: 'pending',
    },
    {
      ticketId: 'B1-REG1', project: projectB1._id, title: 'Company B internal',
      createdBy: developer._id, severity: 'Minor', priority: 'Low', status: 'pending',
    },
  ]);

  const page = await listTickets(clientUser, {});
  assert.deepEqual(page.results.map((t) => t.ticketId), ['A1-REG1']);
  await assert.rejects(() => getTicket(clientUser, 'B1-REG1'), (err) => err.statusCode === 403);
});

test('client_tester with projects A and B sees union, not project C in same company', async () => {
  const { admin, companyA, projectA1, projectA2 } = await seedCompanies();
  const tester = await user(ROLE_IDS.CLIENT_TESTER);
  const developer = await user(ROLE_IDS.DEVELOPER);
  const projectA3 = await Project.create({
    key: 'A3', name: 'A Three', client: companyA._id, createdBy: admin._id,
  });

  await AccessAssignment.create([
    {
      user: tester._id, role: ROLE_IDS.CLIENT_TESTER,
      client: companyA._id, project: projectA1._id, grantedBy: admin._id,
    },
    {
      user: tester._id, role: ROLE_IDS.CLIENT_TESTER,
      client: companyA._id, project: projectA2._id, grantedBy: admin._id,
    },
  ]);

  await Ticket.create([
    {
      ticketId: 'A1-REG2', project: projectA1._id, title: 'In A1',
      createdBy: developer._id, severity: 'Minor', priority: 'Low', status: 'pending',
    },
    {
      ticketId: 'A2-REG2', project: projectA2._id, title: 'In A2',
      createdBy: developer._id, severity: 'Minor', priority: 'Low', status: 'pending',
    },
    {
      ticketId: 'A3-REG2', project: projectA3._id, title: 'In A3',
      createdBy: developer._id, severity: 'Minor', priority: 'Low', status: 'pending',
    },
  ]);

  const page = await listTickets(tester, {});
  assert.deepEqual(page.results.map((t) => t.ticketId).sort(), ['A1-REG2', 'A2-REG2']);
  await assert.rejects(() => getTicket(tester, 'A3-REG2'), (err) => err.statusCode === 403);
});

test('client_tester project assignment does not expand via company row on assignment', async () => {
  const { admin, companyA, projectA1, projectA2 } = await seedCompanies();
  const tester = await user(ROLE_IDS.CLIENT_TESTER);
  const developer = await user(ROLE_IDS.DEVELOPER);

  await AccessAssignment.create({
    user: tester._id,
    role: ROLE_IDS.CLIENT_TESTER,
    client: companyA._id,
    project: projectA1._id,
    grantedBy: admin._id,
  });

  await Ticket.create([
    {
      ticketId: 'A1-REG3', project: projectA1._id, title: 'Scoped project',
      createdBy: developer._id, severity: 'Minor', priority: 'Low', status: 'pending',
    },
    {
      ticketId: 'A2-REG3', project: projectA2._id, title: 'Same company other project',
      createdBy: developer._id, severity: 'Minor', priority: 'Low', status: 'pending',
    },
  ]);

  const page = await listTickets(tester, {});
  assert.deepEqual(page.results.map((t) => t.ticketId), ['A1-REG3']);
});

test('search and counts use the same authorized ticket dataset', async () => {
  const { admin, companyA, projectA1, projectA2 } = await seedCompanies();
  const tester = await user(ROLE_IDS.CLIENT_TESTER);
  const developer = await user(ROLE_IDS.DEVELOPER);

  await AccessAssignment.create({
    user: tester._id,
    role: ROLE_IDS.CLIENT_TESTER,
    client: companyA._id,
    project: projectA1._id,
    grantedBy: admin._id,
  });

  await Ticket.init();
  await Ticket.create([
    {
      ticketId: 'A1-SEARCH', project: projectA1._id, title: 'Findable dashboard bug',
      createdBy: developer._id, severity: 'Minor', priority: 'Low', status: 'pending',
    },
    {
      ticketId: 'A2-SEARCH', project: projectA2._id, title: 'Findable dashboard bug',
      createdBy: developer._id, severity: 'Minor', priority: 'Low', status: 'pending',
    },
  ]);

  const all = await listTickets(tester, {});
  assert.equal(all.totalResults, 1);

  const searched = await listTickets(tester, { q: 'dashboard' });
  assert.equal(searched.totalResults, 1);
  assert.deepEqual(searched.results.map((t) => t.ticketId), ['A1-SEARCH']);
});

test('canExternalViewTicket enforces assignment project scope', async () => {
  const { admin, companyA, projectA1, projectA2 } = await seedCompanies();
  const clientUser = await user(ROLE_IDS.CLIENT);
  const tester = await user(ROLE_IDS.CLIENT_TESTER);
  const developer = await user(ROLE_IDS.DEVELOPER);

  await AccessAssignment.create({
    user: clientUser._id,
    role: ROLE_IDS.CLIENT,
    client: companyA._id,
    project: null,
    grantedBy: admin._id,
  });
  await AccessAssignment.create({
    user: tester._id,
    role: ROLE_IDS.CLIENT_TESTER,
    client: companyA._id,
    project: projectA1._id,
    grantedBy: admin._id,
  });

  const [external, internal, outOfScope] = await Ticket.create([
    {
      ticketId: 'A1-7', project: projectA1._id, title: 'External', createdBy: tester._id,
      severity: 'Minor', priority: 'Low', status: 'pending',
    },
    {
      ticketId: 'A1-7b', project: projectA1._id, title: 'Internal', createdBy: developer._id,
      severity: 'Minor', priority: 'Low', status: 'pending',
    },
    {
      ticketId: 'A2-3', project: projectA2._id, title: 'Other project', createdBy: developer._id,
      severity: 'Minor', priority: 'Low', status: 'pending',
    },
  ]);

  assert.equal(await canExternalViewTicket(clientUser, external), true);
  assert.equal(await canExternalViewTicket(clientUser, internal), true);
  assert.equal(await canExternalViewTicket(clientUser, outOfScope), true);
  assert.equal(await canExternalViewTicket(tester, external), true);
  assert.equal(await canExternalViewTicket(tester, internal), true);
  assert.equal(await canExternalViewTicket(tester, outOfScope), false);
});

test('client with no company assignment has zero access', async () => {
  const { projectA1 } = await seedCompanies();
  const clientUser = await user(ROLE_IDS.CLIENT);

  assert.equal(await hasExternalWorkspaceAccess(clientUser._id), false);
  assert.deepEqual(await permittedClientIdsForExternalUser(clientUser._id), []);
  assert.deepEqual(await permittedProjectIdsForExternalUser(clientUser._id), []);

  const projects = await listProjects({}, clientUser);
  assert.equal(projects.results.length, 0);

  const clients = await listClients({}, null, clientUser);
  assert.equal(clients.results.length, 0);

  const tickets = await listTickets(clientUser, {});
  assert.equal(tickets.results.length, 0);

  await assert.rejects(() => getProject(projectA1._id, clientUser), (err) => err.statusCode === 403);
  await assert.rejects(
    () => createTicket(clientUser, { project: projectA1._id, title: 'Blocked', severity: 'Minor', priority: 'Low' }),
    (err) => err.statusCode === 403,
  );
});

test('client_tester with no company or project assignment has zero access', async () => {
  const { projectA1 } = await seedCompanies();
  const tester = await user(ROLE_IDS.CLIENT_TESTER);

  assert.equal(await hasExternalWorkspaceAccess(tester._id), false);

  const projects = await listProjects({}, tester);
  assert.equal(projects.results.length, 0);

  const tickets = await listTickets(tester, {});
  assert.equal(tickets.results.length, 0);

  await assert.rejects(() => getProject(projectA1._id, tester), (err) => err.statusCode === 403);
  await assert.rejects(
    () => createTicket(tester, { project: projectA1._id, title: 'Blocked', severity: 'Minor', priority: 'Low' }),
    (err) => err.statusCode === 403,
  );
});

test('client with valid company assignment gets correct project access', async () => {
  const { admin, companyA, projectA1, projectA2 } = await seedCompanies();
  const clientUser = await user(ROLE_IDS.CLIENT);

  await AccessAssignment.create({
    user: clientUser._id,
    role: ROLE_IDS.CLIENT,
    client: companyA._id,
    project: null,
    grantedBy: admin._id,
  });

  const permitted = await permittedProjectIdsForExternalUser(clientUser._id);
  assert.deepEqual(permitted.sort(), [String(projectA1._id), String(projectA2._id)].sort());

  const projects = await listProjects({}, clientUser);
  assert.equal(projects.results.length, 2);

  const hydrated = await getProject(projectA1._id, clientUser);
  assert.equal(hydrated.key, 'A1');
});

test('external users cannot create tickets outside their scope', async () => {
  const { admin, companyA, companyB, projectA1, projectB1 } = await seedCompanies();
  const tester = await user(ROLE_IDS.CLIENT_TESTER);

  await AccessAssignment.create({
    user: tester._id,
    role: ROLE_IDS.CLIENT_TESTER,
    client: companyA._id,
    project: projectA1._id,
    grantedBy: admin._id,
  });

  await assert.rejects(
    () => createTicket(tester, { project: projectB1._id, title: 'Cross company', severity: 'Minor', priority: 'Low' }),
    (err) => err.statusCode === 403,
  );

  const ticket = await createTicket(tester, {
    project: projectA1._id, title: 'In scope', severity: 'Minor', priority: 'Low',
  });
  assert.equal(ticket.title, 'In scope');
});

test('notifications hide tickets outside external visibility scope', async () => {
  const { admin, companyA, companyB, projectA1, projectB1 } = await seedCompanies();
  const testerA = await user(ROLE_IDS.CLIENT_TESTER);
  const testerB = await user(ROLE_IDS.CLIENT_TESTER);

  await AccessAssignment.create({
    user: testerA._id,
    role: ROLE_IDS.CLIENT_TESTER,
    client: companyA._id,
    project: null,
    grantedBy: admin._id,
  });
  await AccessAssignment.create({
    user: testerB._id,
    role: ROLE_IDS.CLIENT_TESTER,
    client: companyB._id,
    project: null,
    grantedBy: admin._id,
  });

  const ticketA = await Ticket.create({
    ticketId: 'A1-8', project: projectA1._id, title: 'A only', createdBy: testerA._id,
    severity: 'Minor', priority: 'Low', status: 'pending',
  });
  const ticketB = await Ticket.create({
    ticketId: 'B1-2', project: projectB1._id, title: 'B only', createdBy: testerB._id,
    severity: 'Minor', priority: 'Low', status: 'pending',
  });

  await Notification.insertMany([
    { user: testerA._id, event: 'TICKET_CREATED', ticket: ticketA._id, title: 'A1-8 was filed', body: 'A only' },
    { user: testerA._id, event: 'TICKET_CREATED', ticket: ticketB._id, title: 'B1-2 was filed', body: 'B only' },
  ]);

  const page = await listNotifications(testerA, {});
  assert.deepEqual(page.results.map((n) => n.title), ['A1-8 was filed']);
});

test('company-wide client_tester sync auto-assigns all active projects', async () => {
  const { admin, companyA, projectA1, projectA2 } = await seedCompanies();
  const tester = await user(ROLE_IDS.CLIENT_TESTER);

  await syncCompanyExternalAccess(admin, companyA._id, {
    clientTesterIds: [String(tester._id)],
  });

  const companyWide = await AccessAssignment.findOne({
    client: companyA._id,
    project: null,
    user: tester._id,
    role: ROLE_IDS.CLIENT_TESTER,
    status: 'active',
  });
  assert.ok(companyWide);

  const projectRows = await AccessAssignment.find({
    client: companyA._id,
    user: tester._id,
    role: ROLE_IDS.CLIENT_TESTER,
    status: 'active',
    project: { $ne: null },
  }).sort({ project: 1 });

  assert.equal(projectRows.length, 2);
  assert.deepEqual(
    projectRows.map((row) => String(row.project)).sort(),
    [String(projectA1._id), String(projectA2._id)].sort(),
  );
  assert.ok(projectRows.every((row) => row.reason === COMPANY_WIDE_AUTO_ASSIGN_REASON));
});

test('new project inherits company-wide client testers', async () => {
  const { admin, companyA, projectA1 } = await seedCompanies();
  const tester = await user(ROLE_IDS.CLIENT_TESTER);

  await syncCompanyExternalAccess(admin, companyA._id, {
    clientTesterIds: [String(tester._id)],
  });

  const projectA3 = await createProject(admin, {
    clientId: companyA._id,
    key: 'A3',
    name: 'A Three',
  });

  const row = await AccessAssignment.findOne({
    client: companyA._id,
    project: projectA3.id,
    user: tester._id,
    role: ROLE_IDS.CLIENT_TESTER,
    status: 'active',
  });
  assert.ok(row);
  assert.equal(row.reason, COMPANY_WIDE_AUTO_ASSIGN_REASON);

  const permitted = await permittedProjectIdsForExternalUser(tester._id);
  assert.ok(permitted.includes(String(projectA1._id)));
  assert.ok(permitted.includes(String(projectA3.id)));
});

test('removing company-wide client_tester revokes auto project assignments only', async () => {
  const { admin, companyA, projectA1, projectA2 } = await seedCompanies();
  const companyWideTester = await user(ROLE_IDS.CLIENT_TESTER);
  const manualTester = await user(ROLE_IDS.CLIENT_TESTER);

  await syncCompanyExternalAccess(admin, companyA._id, {
    clientTesterIds: [String(companyWideTester._id)],
  });

  await AccessAssignment.create({
    user: manualTester._id,
    role: ROLE_IDS.CLIENT_TESTER,
    client: companyA._id,
    project: projectA1._id,
    grantedBy: admin._id,
  });

  await syncCompanyExternalAccess(admin, companyA._id, {
    clientTesterIds: [],
  });

  const autoRows = await AccessAssignment.find({
    user: companyWideTester._id,
    client: companyA._id,
    role: ROLE_IDS.CLIENT_TESTER,
    project: { $ne: null },
  });
  assert.ok(autoRows.length > 0);
  assert.ok(autoRows.every((row) => row.status === 'revoked'));

  const manualRow = await AccessAssignment.findOne({
    user: manualTester._id,
    client: companyA._id,
    project: projectA1._id,
    role: ROLE_IDS.CLIENT_TESTER,
    status: 'active',
  });
  assert.ok(manualRow);

  const activeAutoOnA2 = await AccessAssignment.findOne({
    user: companyWideTester._id,
    client: companyA._id,
    project: projectA2._id,
    role: ROLE_IDS.CLIENT_TESTER,
    status: 'active',
  });
  assert.equal(activeAutoOnA2, null);
});

test('company-wide client_tester sync skips duplicate project assignments', async () => {
  const { admin, companyA, projectA1 } = await seedCompanies();
  const tester = await user(ROLE_IDS.CLIENT_TESTER);

  await AccessAssignment.create({
    user: tester._id,
    role: ROLE_IDS.CLIENT_TESTER,
    client: companyA._id,
    project: projectA1._id,
    grantedBy: admin._id,
  });

  await syncCompanyExternalAccess(admin, companyA._id, {
    clientTesterIds: [String(tester._id)],
  });

  const projectRows = await AccessAssignment.find({
    client: companyA._id,
    user: tester._id,
    project: projectA1._id,
    role: ROLE_IDS.CLIENT_TESTER,
    status: 'active',
  });
  assert.equal(projectRows.length, 1);
  assert.notEqual(projectRows[0].reason, COMPANY_WIDE_AUTO_ASSIGN_REASON);
});

test('syncCompanyExternalAccess re-adds users after their company-wide assignment expired', async () => {
  const admin = await user(ROLE_IDS.ADMIN);
  const company = await Client.create({ name: 'Renew Co', status: 'active', createdBy: admin._id });
  const tester = await user(ROLE_IDS.CLIENT_TESTER);

  await syncCompanyExternalAccess(admin, company._id, {
    clientTesterIds: [String(tester._id)],
  });

  const initial = await AccessAssignment.findOne({
    client: company._id,
    project: null,
    user: tester._id,
    role: ROLE_IDS.CLIENT_TESTER,
    status: 'active',
  });
  assert.ok(initial);

  await AccessAssignment.collection.updateOne(
    { _id: initial._id },
    { $set: { expiresAt: new Date(Date.now() - 60_000) } },
  );

  const access = await syncCompanyExternalAccess(admin, company._id, {
    clientTesterIds: [String(tester._id)],
  });

  assert.deepEqual(access.clientTesterIds, [String(tester._id)]);

  const activeRows = await AccessAssignment.find({
    client: company._id,
    project: null,
    user: tester._id,
    role: ROLE_IDS.CLIENT_TESTER,
    status: 'active',
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  });
  assert.equal(activeRows.length, 1);
  assert.notEqual(String(activeRows[0]._id), String(initial._id));
});

test('an external viewer receives public comments, filtered history, and no internal churn', () => {
  const json = sanitizeExternalTicket({
    id: 't1',
    comments: [
      {
        id: 'c1', content: 'Visible', internal: false, createdAt: 'x',
        commentedBy: { id: 'u1', name: 'Ann', email: 'ann@example.com', role: 'developer' },
        mentions: ['u9'], reactions: [{ by: 'u9' }],
        attachments: [
          {
            id: 'att1', key: 'private/uploads/att1.png', name: 'screenshot.png',
            size: 1024, mimeType: 'image/png', uploadedAt: 'x',
            uploadedBy: 'u1', clientRef: 'client-uuid-1',
          },
        ],
      },
      {
        id: 'c2', content: 'Hidden', internal: true, createdAt: 'y',
        commentedBy: { id: 'u2', name: 'Dev' },
      },
      // No `internal` key at all. The schema defaults `internal` to false (public,
      // per product rule), so a comment hydrated without the field must still be
      // treated as visible, not swallowed by a strict `=== false` check.
      {
        id: 'c3', content: 'No internal flag set', createdAt: 'x2',
        commentedBy: { id: 'u1', name: 'Ann' },
      },
    ],
    stageHistory: [
      {
        id: 's1', from: 'pending', to: 'under_review', at: 'z',
        by: { id: 'u3', name: 'Admin' }, note: 'client is pushy', decision: 'rejected',
      },
    ],
    activityLog: [
      {
        id: 'a1', action: 'created', at: 'w', performedBy: { id: 'u1', name: 'Ann' },
        changes: [{ field: 'title', from: 'Old', to: 'New' }],
      },
      {
        id: 'a2', action: 'assigned', at: 'v', performedBy: { id: 'u3', name: 'Admin' },
        changes: [{ field: 'assignedTo', to: 'u4' }],
      },
    ],
  });

  assert.equal(json.comments.length, 2);
  assert.equal(json.comments[0].content, 'Visible');
  assert.equal(json.comments[0].mentions, undefined);
  assert.equal(json.comments[0].reactions, undefined);
  assert.equal(json.comments[1].content, 'No internal flag set');

  // Exact key set — a regression that lets an extra field (mentions, reactions,
  // raw internal fields, etc.) pass through would fail this even if the values
  // asserted above still look right.
  assert.deepEqual(
    Object.keys(json.comments[0]).sort(),
    ['attachments', 'commentedBy', 'content', 'createdAt', 'editedAt', 'id'],
  );

  // commentedBy is reduced to {id, name, external} — email/role from the fixture
  // must not leak; `external` lets the client UI align discussion bubbles.
  assert.deepEqual(json.comments[0].commentedBy, { id: 'u1', name: 'Ann', external: false });

  // Attachment reduction: storage key, internal uploader id, and client dedupe
  // token are stripped; the id survives because the frontend builds download
  // links from file._id || file.id.
  assert.deepEqual(
    json.comments[0].attachments.map((a) => Object.keys(a).sort()),
    [['id', 'mimeType', 'name', 'size', 'uploadedAt']],
  );
  assert.deepEqual(json.comments[0].attachments[0], {
    id: 'att1', name: 'screenshot.png', size: 1024, mimeType: 'image/png', uploadedAt: 'x',
  });

  assert.equal(json.stageHistory.length, 1);
  assert.equal(json.stageHistory[0].to, 'under_review');
  assert.equal(json.stageHistory[0].note, undefined);
  assert.equal(json.stageHistory[0].decision, undefined);
  assert.deepEqual(json.stageHistory[0].by, { id: 'u3', name: 'Admin' });

  assert.equal(json.activityLog.length, 1);
  assert.equal(json.activityLog[0].action, 'created');
  // The visible `created` entry's own fixture carried a non-empty `changes`, so
  // this only passes if the service forces it to [] rather than passing it through.
  assert.deepEqual(json.activityLog[0].changes, []);
  assert.deepEqual(json.activityLog[0].performedBy, { id: 'u1', name: 'Ann' });
});

test('a QA report screenshot is stripped from the external attachments list', () => {
  const shot = {
    _id: 'att-qa', name: 'shot.png', size: 42, mimeType: 'image/png', uploadedAt: 'x',
    key: 'tickets/shot.png', uploadedBy: 'u3',
  };
  const json = sanitizeExternalTicket({
    id: 't3',
    comments: [],
    activityLog: [],
    // The same entry is on the ticket-level array, which carries no internal
    // flag of its own — hiding the stage entry is not enough on its own.
    attachments: [shot, { _id: 'att-ok', name: 'spec.pdf', size: 9, mimeType: 'application/pdf', uploadedAt: 'y', key: 'k', uploadedBy: 'u1' }],
    stageHistory: [{
      id: 's1', from: 'ready_qa', to: 'in_progress', at: 'z',
      by: { _id: 'u3', name: 'Admin' }, decision: 'rejected',
      note: 'Login breaks on Safari', attachments: [shot],
    }],
  });

  assert.deepEqual(json.attachments.map((a) => a.id), ['att-ok']);
  assert.equal(json.stageHistory[0].note, undefined);
  assert.equal(json.stageHistory[0].decision, undefined);
  assert.equal(json.stageHistory[0].attachments, undefined);
});

test('a ticket whose comments are all internal returns an empty array', () => {
  const json = sanitizeExternalTicket({
    id: 't2',
    comments: [{ id: 'c1', content: 'Hidden', internal: true }],
    stageHistory: [],
    activityLog: [],
  });
  assert.deepEqual(json.comments, []);
});

test('sanitizeExternalTicket hides other watchers but keeps the viewer when watching', () => {
  const viewerId = 'viewer-1';
  const json = sanitizeExternalTicket({
    id: 't-watch',
    watchers: [
      { id: viewerId, name: 'Client User' },
      { id: 'dev-9', name: 'Internal Dev' },
    ],
    comments: [],
    stageHistory: [],
    activityLog: [],
  }, { viewerId });

  assert.deepEqual(json.watchers, [{ id: viewerId, name: 'Client User' }]);
});

test('sanitizeExternalTicket returns empty watchers when viewer is not watching', () => {
  const json = sanitizeExternalTicket({
    id: 't-watch-2',
    watchers: [{ id: 'dev-9', name: 'Internal Dev' }],
    comments: [],
    stageHistory: [],
    activityLog: [],
  }, { viewerId: 'viewer-1' });

  assert.deepEqual(json.watchers, []);
});

test('sanitizeExternalTicket returns empty watchers without a viewerId', () => {
  const json = sanitizeExternalTicket({
    id: 't-watch-3',
    watchers: [{ id: 'viewer-1', name: 'Client User' }],
    comments: [],
    stageHistory: [],
    activityLog: [],
  });

  assert.deepEqual(json.watchers, []);
});

test('sanitizeExternalTicket stringifies raw (unpopulated) ObjectId refs via pickPerson', () => {
  // Task 12c item A: the old inline maps did `.id ?? ._id`, and a bare
  // (unpopulated) ObjectId's `.id` getter is the raw 12-byte buffer, not a
  // string — that buffer would ride straight into the JSON response.
  // pickPerson checks `._id` first and Strings the result.
  const rawCreatedBy = new mongoose.Types.ObjectId();
  const rawAssignedTo = new mongoose.Types.ObjectId();
  const rawTeam = new mongoose.Types.ObjectId();

  const json = sanitizeExternalTicket({
    id: 't3',
    createdBy: rawCreatedBy,
    assignedTo: rawAssignedTo,
    team: rawTeam,
    comments: [],
    stageHistory: [],
    activityLog: [],
  });

  assert.deepEqual(json.createdBy, { id: String(rawCreatedBy), name: null });
  assert.deepEqual(json.assignedTo, { id: String(rawAssignedTo), name: null });
  assert.deepEqual(json.team, { id: String(rawTeam), name: null });
  assert.equal(typeof json.createdBy.id, 'string');
  assert.match(json.createdBy.id, /^[0-9a-f]{24}$/);
});

test('sanitizeExternalTicket reduces ticket-level attachments and drops ones shared with an internal comment', () => {
  const json = sanitizeExternalTicket({
    id: 't4',
    attachments: [
      {
        id: 'att-pub', key: 'private/att-pub.png', name: 'public.png',
        size: 10, mimeType: 'image/png', uploadedAt: 'x', uploadedBy: 'u1', clientRef: 'c1',
      },
      {
        id: 'att-priv', key: 'private/att-priv.png', name: 'private.png',
        size: 20, mimeType: 'image/png', uploadedAt: 'x', uploadedBy: 'u1', clientRef: 'c2',
      },
    ],
    comments: [
      {
        id: 'c1', content: 'internal note', internal: true, createdAt: 'y',
        commentedBy: { id: 'u2', name: 'Dev' },
        // Same id as the ticket-level "private" attachment: uploaded onto this
        // internal comment, so it must be excluded from the top-level list too,
        // even though the ticket-level array itself carries no `internal` flag.
        attachments: [
          {
            id: 'att-priv', key: 'private/att-priv.png', name: 'private.png',
            size: 20, mimeType: 'image/png', uploadedAt: 'x', uploadedBy: 'u1', clientRef: 'c2',
          },
        ],
      },
    ],
    stageHistory: [],
    activityLog: [],
  });

  assert.equal(json.attachments.length, 1);
  assert.equal(json.attachments[0].id, 'att-pub');
  assert.deepEqual(
    Object.keys(json.attachments[0]).sort(),
    ['id', 'mimeType', 'name', 'size', 'uploadedAt'],
  );
});

test("an external user's notification list has its nested ticket fully sanitized", async () => {
  const { admin, companyA, projectA1 } = await seedCompanies();
  const tester = await user(ROLE_IDS.CLIENT_TESTER);
  const dev = await user(ROLE_IDS.DEVELOPER);

  await AccessAssignment.create({
    user: tester._id, role: ROLE_IDS.CLIENT_TESTER,
    client: companyA._id, project: null, grantedBy: admin._id,
  });

  const ticket = await Ticket.create({
    ticketId: 'A1-9', project: projectA1._id, title: 'Sanitize me', createdBy: tester._id,
    severity: 'Minor', priority: 'Low', status: 'closed',
    comments: [
      { content: 'Public update', commentedBy: dev._id, internal: false, createdAt: new Date() },
      { content: 'Internal notes', commentedBy: dev._id, internal: true, createdAt: new Date() },
    ],
    stageHistory: [
      { to: 'pending', by: admin._id, at: new Date() },
      {
        from: 'live', to: 'closed', by: admin._id, at: new Date(),
        decision: 'approved', note: 'Closed on client behalf',
      },
    ],
    activityLog: [
      { action: 'created', performedBy: tester._id, at: new Date(), changes: [] },
      {
        action: 'transitioned', performedBy: admin._id, at: new Date(),
        changes: [{ field: 'status', from: 'live', to: 'closed' }],
      },
    ],
  });

  await Notification.create({
    user: tester._id, event: 'TICKET_CLOSED', ticket: ticket._id,
    title: 'A1-9 was closed', body: 'Sanitize me',
  });

  const page = await listNotifications(tester, {});
  const [notification] = page.results;
  assert.ok(notification.ticket, 'the ticket is populated');

  // The list carries only the ticket summary, so nothing internal can leak.
  assert.equal(notification.ticket.title, 'Sanitize me');
  for (const field of ['comments', 'stageHistory', 'activityLog', 'watchers']) {
    assert.equal(notification.ticket[field]?.length ?? 0, 0, `${field} is empty`);
  }
  assert.equal(notification.ticket.testedBy ?? null, null);
});

test('external user can watch a visible ticket and see Watching state on reload', async () => {
  const { admin, companyA, projectA1 } = await seedCompanies();
  const tester = await user(ROLE_IDS.CLIENT_TESTER);
  const internalDev = await user(ROLE_IDS.DEVELOPER);

  await AccessAssignment.create({
    user: tester._id,
    role: ROLE_IDS.CLIENT_TESTER,
    client: companyA._id,
    project: null,
    grantedBy: admin._id,
  });

  await Ticket.create({
    ticketId: 'A1-10',
    project: projectA1._id,
    title: 'Watch me',
    createdBy: tester._id,
    watchers: [internalDev._id],
    severity: 'Minor',
    priority: 'Low',
    status: 'pending',
  });

  const before = await getTicket(tester, 'A1-10');
  assert.deepEqual(before.watchers, []);

  const watching = await watchTicket(tester, 'A1-10');
  assert.equal(watching.watchers.length, 1);
  assert.equal(String(watching.watchers[0].id), String(tester._id));

  const after = await getTicket(tester, 'A1-10');
  assert.equal(after.watchers.length, 1);
  assert.equal(String(after.watchers[0].id), String(tester._id));

  const cleared = await unwatchTicket(tester, 'A1-10');
  assert.deepEqual(cleared.watchers, []);
});

test('sanitizeExternalTicket drops the blocker reason and the internal staff id that set it', () => {
  const json = sanitizeExternalTicket({
    id: 't-blocked',
    title: 'Login fails',
    blocked: true,
    blockedAt: '2026-08-20T10:00:00.000Z',
    blockerReason: 'Waiting on their vendor; account manager says stop chasing it',
    blockedBy: '68a1f0c0c0c0c0c0c0c0c0c0',
  });

  // Status the client is entitled to.
  assert.equal(json.blocked, true);
  assert.equal(json.blockedAt, '2026-08-20T10:00:00.000Z');
  // Internal triage note and staff id.
  assert.equal('blockerReason' in json, false);
  assert.equal('blockedBy' in json, false);
});

test('expired external assignments deny access across authorization helpers', async () => {
  const { admin, companyA, projectA1 } = await seedCompanies();
  const tester = await user(ROLE_IDS.CLIENT_TESTER);

  const assignment = await AccessAssignment.create({
    user: tester._id,
    role: ROLE_IDS.CLIENT_TESTER,
    client: companyA._id,
    project: projectA1._id,
    grantedBy: admin._id,
    expiresAt: new Date(Date.now() + 60_000),
  });

  await AccessAssignment.collection.updateOne(
    { _id: assignment._id },
    { $set: { expiresAt: new Date(Date.now() - 60_000) } },
  );

  assert.equal(await hasExternalWorkspaceAccess(tester._id), false);
  assert.deepEqual(await permittedClientIdsForExternalUser(tester._id), []);
  assert.deepEqual(await permittedProjectIdsForExternalUser(tester._id), []);
  assert.equal(await externalUserCoversProject(tester._id, companyA._id, projectA1._id), false);
  assert.deepEqual(await activeAssignmentsForUser(tester._id), []);
  assert.deepEqual(await buildExternalTicketFilter(tester), { _id: null });

  const ticket = await Ticket.create({
    ticketId: 'A1-EXP', project: projectA1._id, title: 'Expired scope', createdBy: tester._id,
    severity: 'Minor', priority: 'Low', status: 'pending',
  });
  assert.equal(await canExternalViewTicket(tester, ticket), false);

  const projects = await listProjects({}, tester);
  assert.equal(projects.results.length, 0);

  await assert.rejects(() => getProject(projectA1._id, tester), (err) => err.statusCode === 403);
  await assert.rejects(
    () => createTicket(tester, { project: projectA1._id, title: 'Blocked', severity: 'Minor', priority: 'Low' }),
    (err) => err.statusCode === 403,
  );
});

test('project client change revokes project-specific external assignments for the old company', async () => {
  const { admin, companyA, companyB, projectA1 } = await seedCompanies();
  const tester = await user(ROLE_IDS.CLIENT_TESTER);

  const projectScoped = await AccessAssignment.create({
    user: tester._id,
    role: ROLE_IDS.CLIENT_TESTER,
    client: companyA._id,
    project: projectA1._id,
    grantedBy: admin._id,
  });
  const companyWide = await AccessAssignment.create({
    user: tester._id,
    role: ROLE_IDS.CLIENT_TESTER,
    client: companyA._id,
    project: null,
    grantedBy: admin._id,
  });

  await Project.findByIdAndUpdate(projectA1._id, { $set: { client: companyB._id } });
  await revokeProjectExternalAssignmentsOnClientChange(projectA1._id, companyA._id);

  const revoked = await AccessAssignment.findById(projectScoped._id);
  assert.equal(revoked.status, 'revoked');
  assert.equal(revoked.reason, 'project_client_changed');

  const untouched = await AccessAssignment.findById(companyWide._id);
  assert.equal(untouched.status, 'active');
});

test('scope consistency: client company-wide sees all active company projects', async () => {
  const { admin, companyA, projectA1, projectA2 } = await seedCompanies();
  const clientUser = await user(ROLE_IDS.CLIENT);
  const projectA3 = await Project.create({
    key: 'A3', name: 'A Three', client: companyA._id, createdBy: admin._id,
  });

  await AccessAssignment.create({
    user: clientUser._id,
    role: ROLE_IDS.CLIENT,
    client: companyA._id,
    project: null,
    grantedBy: admin._id,
  });

  const permitted = await assertExternalScopeConsistent(clientUser);
  assert.deepEqual(
    permitted.sort(),
    [String(projectA1._id), String(projectA2._id), String(projectA3._id)].sort(),
  );
});

test('scope consistency: client_tester company-wide plus explicit projects is union without dupes', async () => {
  const { admin, companyA, projectA1, projectA2 } = await seedCompanies();
  const tester = await user(ROLE_IDS.CLIENT_TESTER);
  const projectA3 = await Project.create({
    key: 'A3', name: 'A Three', client: companyA._id, createdBy: admin._id,
  });

  await AccessAssignment.create([
    {
      user: tester._id, role: ROLE_IDS.CLIENT_TESTER,
      client: companyA._id, project: null, grantedBy: admin._id,
    },
    {
      user: tester._id, role: ROLE_IDS.CLIENT_TESTER,
      client: companyA._id, project: projectA1._id, grantedBy: admin._id,
    },
    {
      user: tester._id, role: ROLE_IDS.CLIENT_TESTER,
      client: companyA._id, project: projectA2._id, grantedBy: admin._id,
    },
  ]);

  const permitted = await assertExternalScopeConsistent(tester);
  assert.deepEqual(
    permitted.sort(),
    [String(projectA1._id), String(projectA2._id), String(projectA3._id)].sort(),
  );
});

test('scope consistency: revoked assignment drops project from projects, tickets, and board filter', async () => {
  const { admin, companyA, projectA1, projectA2 } = await seedCompanies();
  const tester = await user(ROLE_IDS.CLIENT_TESTER);
  const developer = await user(ROLE_IDS.DEVELOPER);

  const assignment = await AccessAssignment.create({
    user: tester._id,
    role: ROLE_IDS.CLIENT_TESTER,
    client: companyA._id,
    project: projectA1._id,
    grantedBy: admin._id,
  });
  await AccessAssignment.create({
    user: tester._id,
    role: ROLE_IDS.CLIENT_TESTER,
    client: companyA._id,
    project: projectA2._id,
    grantedBy: admin._id,
  });

  await Ticket.create([
    {
      ticketId: 'A1-REV', project: projectA1._id, title: 'Revoked project',
      createdBy: developer._id, severity: 'Minor', priority: 'Low', status: 'pending',
    },
    {
      ticketId: 'A2-REV', project: projectA2._id, title: 'Still visible',
      createdBy: developer._id, severity: 'Minor', priority: 'Low', status: 'pending',
    },
  ]);

  await assertExternalScopeConsistent(tester);

  assignment.status = 'revoked';
  assignment.reason = 'test_revoke';
  await assignment.save();

  const permitted = await assertExternalScopeConsistent(tester);
  assert.deepEqual(permitted, [String(projectA2._id)]);

  const allTickets = await listTickets(tester, {});
  assert.deepEqual(allTickets.results.map((t) => t.ticketId), ['A2-REV']);

  // Simulates board/list with stale activeProjectId from localStorage.
  const staleBoard = await listTickets(tester, { project: String(projectA1._id) });
  assert.equal(staleBoard.results.length, 0);

  await assert.rejects(() => getProject(projectA1._id, tester), (err) => err.statusCode === 403);
  await assert.rejects(() => getTicket(tester, 'A1-REV'), (err) => err.statusCode === 403);
});

test('scope consistency: new company project appears after company-wide client_tester grant', async () => {
  const { admin, companyA, projectA1 } = await seedCompanies();
  const tester = await user(ROLE_IDS.CLIENT_TESTER);

  await AccessAssignment.create({
    user: tester._id,
    role: ROLE_IDS.CLIENT_TESTER,
    client: companyA._id,
    project: null,
    grantedBy: admin._id,
  });

  const before = await assertExternalScopeConsistent(tester);
  assert.ok(before.includes(String(projectA1._id)));

  const projectA3 = await createProject(admin, {
    clientId: companyA._id,
    key: 'A3',
    name: 'A Three',
  });

  const after = await assertExternalScopeConsistent(tester);
  assert.ok(after.includes(String(projectA3.id)));
  assert.equal(after.length, before.length + 1);
});
