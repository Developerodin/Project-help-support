import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS } from '@pms/shared';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Client from '../../clients/client.model.js';
import Project from '../project.model.js';
import Team from '../../teams/team.model.js';
import Ticket from '../../tickets/ticket.model.js';
import ProjectTeamMember from '../project-team-member.model.js';
import {
  assignProjectTeam,
  listProjectTeamMembers,
  migrateAllLegacyProjectTeams,
  migrateProjectTeamFromLegacy,
  replaceProjectTeamMemberRoles,
} from '../project-team-member.service.js';
import { createProject, getProject, updateProject } from '../project.service.js';
import { createTicket, assignTicket, getTicket } from '../../tickets/ticket.service.js';

withMemoryDb();

const user = (role = ROLE_IDS.READ_ONLY, name = role) => User.create({
  name,
  email: `${role}-${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password',
  status: 'active',
  role,
});

async function seedProjectWithTeam() {
  const admin = await user(ROLE_IDS.ADMIN, 'Admin');
  const lead = await user(ROLE_IDS.DEVELOPER, 'Harsh Bansal');
  const developer = await user(ROLE_IDS.DEVELOPER, 'Akshay Pareek');
  const qa = await user(ROLE_IDS.TESTER, 'Harsh QA');
  const team = await Team.create({
    name: 'Web Team',
    lead: lead._id,
    members: [developer._id, qa._id],
    createdBy: admin._id,
  });
  const client = await Client.create({ name: 'Acme', status: 'active', createdBy: admin._id });
  const project = await Project.create({
    key: 'WEB',
    client: client._id,
    name: 'Web App',
    createdBy: admin._id,
    defaultTeam: team._id,
    defaultAssignee: lead._id,
    defaultTester: qa._id,
  });
  await assignProjectTeam(project._id, team._id);
  return { admin, lead, developer, qa, team, project };
}

test('migrates legacy defaults into project team members', async () => {
  const { project, lead, qa } = await seedProjectWithTeam();
  const hydrated = await getProject(project._id);

  assert.equal(hydrated.team?.name, 'Web Team');
  assert.equal(hydrated.teamMembers.length, 3);
  assert.ok(hydrated.teamMembers.some((m) => m.user.id === String(lead._id) && m.role === 'team_lead'));
  assert.ok(hydrated.teamMembers.some((m) => m.user.id === String(qa._id) && m.role === 'qa'));
});

test('same user can have different roles on different projects', async () => {
  const admin = await user(ROLE_IDS.ADMIN);
  const person = await user(ROLE_IDS.DEVELOPER, 'Poly');
  const team = await Team.create({ name: 'Shared', members: [person._id], createdBy: admin._id });
  const client = await Client.create({ name: 'A Co', status: 'active', createdBy: admin._id });
  const web = await Project.create({ key: 'WEB', client: client._id, name: 'Web', createdBy: admin._id, team: team._id });
  const mob = await Project.create({ key: 'MOB', client: client._id, name: 'Mobile', createdBy: admin._id, team: team._id });
  await assignProjectTeam(web._id, team._id);
  await assignProjectTeam(mob._id, team._id);

  await replaceProjectTeamMemberRoles(web._id, [{ userId: String(person._id), role: 'team_lead' }]);
  await replaceProjectTeamMemberRoles(mob._id, [{ userId: String(person._id), role: 'qa' }]);

  const webMembers = await listProjectTeamMembers(web._id);
  const mobMembers = await listProjectTeamMembers(mob._id);
  assert.equal(webMembers[0].role, 'team_lead');
  assert.equal(mobMembers[0].role, 'qa');
});

test('ticket assignee must belong to the project team', async () => {
  const { admin, project, team, qa, developer } = await seedProjectWithTeam();
  const outsider = await user(ROLE_IDS.DEVELOPER, 'Outsider');

  const ticket = await createTicket(admin, { project: project._id, title: 'Bug' });
  assert.equal(String(ticket.team), String(team._id));

  await assert.rejects(
    () => assignTicket(admin, ticket.id, { assignedTo: outsider._id, revision: ticket.revision }),
    (err) => err.code === 'ASSIGNEE_NOT_ELIGIBLE',
  );

  const assigned = await assignTicket(admin, ticket.id, { assignedTo: qa._id, revision: ticket.revision });
  assert.equal(String(assigned.assignedTo), String(qa._id));
  assert.equal((await getTicket(qa, ticket.ticketId)).ticketId, ticket.ticketId);

  const devTicket = await assignTicket(admin, ticket.id, { assignedTo: developer._id, revision: assigned.revision });
  assert.equal(String(devTicket.assignedTo), String(developer._id));
});

test('changing project team resyncs eligible members', async () => {
  const admin = await user(ROLE_IDS.ADMIN);
  const userA = await user(ROLE_IDS.DEVELOPER, 'A');
  const userB = await user(ROLE_IDS.TESTER, 'B');
  const teamA = await Team.create({ name: 'Team A', members: [userA._id], createdBy: admin._id });
  const teamB = await Team.create({ name: 'Team B', members: [userB._id], createdBy: admin._id });
  const client = await Client.create({ name: 'X Co', status: 'active', createdBy: admin._id });
  const project = await createProject(admin, { clientId: client.id, name: 'Portal', team: teamA._id });

  await updateProject(project.id, { team: teamB._id });
  const members = await listProjectTeamMembers(project.id);
  assert.deepEqual(members.map((m) => m.user.id), [String(userB._id)]);
});

test('create ticket defaults assignee and tester from project roles', async () => {
  const { admin, project, lead, qa } = await seedProjectWithTeam();
  const ticket = await createTicket(admin, { project: project._id, title: 'Checkout bug' });
  assert.equal(String(ticket.assignedTo), String(lead._id));
  assert.equal(String(ticket.testedBy), String(qa._id));
});

test('qa assigned to ticket can view it', async () => {
  const { admin, project, qa } = await seedProjectWithTeam();
  const ticket = await createTicket(admin, { project: project._id, title: 'QA path' });
  const assigned = await assignTicket(admin, ticket.id, { assignedTo: qa._id, revision: ticket.revision });
  assert.equal((await getTicket(qa, assigned.ticketId)).ticketId, assigned.ticketId);
});

test('migrateProjectTeamFromLegacy is idempotent', async () => {
  const admin = await user(ROLE_IDS.ADMIN);
  const lead = await user(ROLE_IDS.DEVELOPER, 'Lead');
  const qa = await user(ROLE_IDS.TESTER, 'QA');
  const team = await Team.create({
    name: 'Legacy Team',
    lead: lead._id,
    members: [qa._id],
    createdBy: admin._id,
  });
  const client = await Client.create({ name: 'Legacy Co', status: 'active', createdBy: admin._id });
  const project = await Project.create({
    key: 'LEG',
    client: client._id,
    name: 'Legacy',
    createdBy: admin._id,
    defaultTeam: team._id,
    defaultAssignee: lead._id,
    defaultTester: qa._id,
  });

  await migrateProjectTeamFromLegacy(project);
  const firstCount = await ProjectTeamMember.countDocuments({ project: project._id });

  await migrateProjectTeamFromLegacy(await Project.findById(project._id));
  const secondCount = await ProjectTeamMember.countDocuments({ project: project._id });
  assert.equal(firstCount, secondCount);

  const refreshed = await Project.findById(project._id);
  assert.equal(refreshed.defaultTeam, null);
  assert.equal(refreshed.defaultAssignee, null);
  assert.equal(refreshed.defaultTester, null);
});

test('migrateAllLegacyProjectTeams batch migrates remaining legacy defaults', async () => {
  const admin = await user(ROLE_IDS.ADMIN);
  const person = await user(ROLE_IDS.DEVELOPER, 'Person');
  const team = await Team.create({ name: 'Batch Team', members: [person._id], createdBy: admin._id });
  const client = await Client.create({ name: 'Batch Co', status: 'active', createdBy: admin._id });
  await Project.create({
    key: 'BAT',
    client: client._id,
    name: 'Batch',
    createdBy: admin._id,
    defaultTeam: team._id,
    defaultAssignee: person._id,
  });

  const result = await migrateAllLegacyProjectTeams();
  assert.equal(result.migrated, 1);
  assert.equal(result.failed, 0);

  const project = await Project.findOne({ key: 'BAT' });
  assert.equal(project.defaultTeam, null);
  assert.ok(await ProjectTeamMember.exists({ project: project._id, user: person._id }));
});

test('migrateProjectTeamFromLegacy rejects inactive team without creating members', async () => {
  const admin = await user(ROLE_IDS.ADMIN);
  const person = await user(ROLE_IDS.DEVELOPER, 'Inactive');
  const team = await Team.create({
    name: 'Inactive Team',
    members: [person._id],
    status: 'archived',
    createdBy: admin._id,
  });
  const client = await Client.create({ name: 'Inactive Co', status: 'active', createdBy: admin._id });
  const project = await Project.create({
    key: 'INA',
    client: client._id,
    name: 'Inactive',
    createdBy: admin._id,
    defaultTeam: team._id,
  });

  await assert.rejects(
    () => migrateProjectTeamFromLegacy(project),
    (err) => err.code === 'TEAM_NOT_FOUND',
  );
  assert.equal(await ProjectTeamMember.countDocuments({ project: project._id }), 0);
});

test('replacing roles never empties the roster mid-write and keeps untouched rows', async () => {
  const { project, lead, developer, qa } = await seedProjectWithTeam();
  const before = await ProjectTeamMember.findOne({ project: project._id, user: lead._id }).lean();

  await replaceProjectTeamMemberRoles(project._id, [
    { userId: String(lead._id), role: 'team_lead' },
    { userId: String(developer._id), role: 'developer' },
  ]);

  const rows = await ProjectTeamMember.find({ project: project._id }).lean();
  assert.deepEqual(rows.map((r) => String(r.user)).sort(), [String(lead._id), String(developer._id)].sort());
  assert.equal(rows.find((r) => String(r.user) === String(developer._id)).role, 'developer');
  // Updated in place, not deleted and re-inserted.
  assert.equal(String(rows.find((r) => String(r.user) === String(lead._id))._id), String(before._id));
  assert.ok(!rows.some((r) => String(r.user) === String(qa._id)));
});

test('re-assigning the same team twice at once does not E11000', async () => {
  const { project, team } = await seedProjectWithTeam();
  await Promise.all([assignProjectTeam(project._id, team._id), assignProjectTeam(project._id, team._id)]);
  assert.equal(await ProjectTeamMember.countDocuments({ project: project._id }), 3);
});
