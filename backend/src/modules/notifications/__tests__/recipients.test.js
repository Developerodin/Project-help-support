import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS } from '@pms/shared';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Team from '../../teams/team.model.js';
import Client from '../../clients/client.model.js';
import Project from '../../projects/project.model.js';
import ProjectTeamMember from '../../projects/project-team-member.model.js';
import AccessAssignment from '../../access/accessAssignment.model.js';
import Ticket from '../../tickets/ticket.model.js';
import Notification from '../notification.model.js';
import { getNotificationRecipients, resolvePreference } from '../recipients.js';
import { createInAppNotifications } from '../notification.service.js';

withMemoryDb();

const user = (role = ROLE_IDS.DEVELOPER, name = role) => User.create({
  name, email: `${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password', status: 'active', role,
});

test('the always-set is reporter, watchers, assignee, tester and team members', async () => {
  const reporter = await user();
  const watcher = await user();
  const assignee = await user(ROLE_IDS.DEVELOPER);
  const tester = await user(ROLE_IDS.TESTER);
  const member = await user(ROLE_IDS.DEVELOPER);
  const actor = await user(ROLE_IDS.ADMIN);

  const team = await Team.create({ name: 'Squad', members: [member._id], createdBy: actor._id });
  const project = await Project.create({ key: 'WEB', name: 'Web App', createdBy: actor._id });
  const ticket = await Ticket.create({
    ticketId: 'WEB-1', project: project._id, title: 'x', createdBy: reporter._id,
    watchers: [watcher._id], assignedTo: assignee._id, testedBy: tester._id, team: team._id,
    status: 'in_progress',
  });

  const recipients = await getNotificationRecipients(
    'TICKET_STAGE_CHANGED', ticket, actor, { to: 'in_progress' },
  );
  const ids = recipients.map((r) => String(r.user._id)).sort();

  assert.deepEqual(
    ids,
    [reporter._id, watcher._id, assignee._id, tester._id, member._id].map(String).sort(),
  );
});

test('the assignee still hears about it after stage 6 — they fixed the bug', async () => {
  const reporter = await user();
  const assignee = await user(ROLE_IDS.DEVELOPER);
  const actor = await user(ROLE_IDS.ADMIN);
  const team = await Team.create({ name: 'Squad', members: [assignee._id], createdBy: actor._id });
  const project = await Project.create({ key: 'WEB', name: 'Web App', createdBy: actor._id });
  const ticket = await Ticket.create({
    ticketId: 'WEB-1', project: project._id, title: 'x',
    createdBy: reporter._id, assignedTo: assignee._id, team: team._id, status: 'live',
  });

  const recipients = await getNotificationRecipients(
    'TICKET_STAGE_CHANGED', ticket, actor, { to: 'live' },
  );

  assert.ok(recipients.some((r) => String(r.user._id) === String(assignee._id)));
});

test('stage-entry broadcasts stay scoped to the ticket project team', async () => {
  const reporter = await user();
  const tester = await user(ROLE_IDS.TESTER);
  const teamLead = await user(ROLE_IDS.DEVELOPER);
  const outsiderTester = await user(ROLE_IDS.TESTER);
  const outsiderAdmin = await user(ROLE_IDS.ADMIN);
  const actor = await user(ROLE_IDS.ADMIN);
  const team = await Team.create({
    name: 'Web Team',
    members: [tester._id],
    lead: teamLead._id,
    createdBy: actor._id,
  });
  const project = await Project.create({
    key: 'WEB',
    name: 'Web App',
    createdBy: actor._id,
    team: team._id,
  });
  await ProjectTeamMember.create([
    { project: project._id, team: team._id, user: tester._id, role: 'qa' },
    { project: project._id, team: team._id, user: teamLead._id, role: 'team_lead' },
  ]);
  const ticket = await Ticket.create({
    ticketId: 'WEB-1',
    project: project._id,
    team: team._id,
    title: 'x',
    createdBy: reporter._id,
    status: 'pending',
  });

  const commentInQa = await getNotificationRecipients(
    'TICKET_COMMENTED', ticket, actor, { to: 'ready_qa' },
  );
  assert.ok(commentInQa.some((r) => String(r.user._id) === String(reporter._id)));
  assert.ok(!commentInQa.some((r) => String(r.user._id) === String(outsiderTester._id)));

  const toQa = await getNotificationRecipients(
    'TICKET_STAGE_CHANGED', ticket, actor, { to: 'ready_qa' },
  );
  assert.ok(toQa.some((r) => String(r.user._id) === String(tester._id)));
  assert.ok(!toQa.some((r) => String(r.user._id) === String(outsiderTester._id)));

  const toRelease = await getNotificationRecipients(
    'TICKET_STAGE_CHANGED', ticket, actor, { to: 'live' },
  );
  assert.ok(toRelease.some((r) => String(r.user._id) === String(teamLead._id)));
  assert.ok(!toRelease.some((r) => String(r.user._id) === String(outsiderAdmin._id)));
});

test('external recipients align with external ticket visibility (project and company-wide)', async () => {
  const actor = await user(ROLE_IDS.ADMIN);
  const reporter = await user(ROLE_IDS.DEVELOPER);
  const allowedProjectClientUser = await user(ROLE_IDS.CLIENT);
  const companyWideClientUser = await user(ROLE_IDS.CLIENT);
  const outsiderClientTester = await user(ROLE_IDS.CLIENT_TESTER);

  const clientA = await Client.create({ name: `Client A ${Date.now()}`, createdBy: actor._id });
  const clientB = await Client.create({ name: `Client B ${Date.now()}`, createdBy: actor._id });

  const projectA = await Project.create({
    key: 'WBA',
    name: 'Web A',
    client: clientA._id,
    createdBy: actor._id,
  });
  const projectB = await Project.create({
    key: 'WBB',
    name: 'Web B',
    client: clientB._id,
    createdBy: actor._id,
  });

  const team = await Team.create({ name: 'Client Team', createdBy: actor._id });

  await AccessAssignment.create([
    {
      user: allowedProjectClientUser._id,
      role: ROLE_IDS.CLIENT,
      client: clientA._id,
      project: projectA._id,
      grantedBy: actor._id,
    },
    {
      user: companyWideClientUser._id,
      role: ROLE_IDS.CLIENT,
      client: clientA._id,
      project: null,
      grantedBy: actor._id,
    },
    {
      user: outsiderClientTester._id,
      role: ROLE_IDS.CLIENT_TESTER,
      client: clientB._id,
      project: projectB._id,
      grantedBy: actor._id,
    },
  ]);

  const ticket = await Ticket.create({
    ticketId: 'WBA-1',
    project: projectA._id,
    team: team._id,
    title: 'Scoped audience only',
    createdBy: reporter._id,
    watchers: [allowedProjectClientUser._id, companyWideClientUser._id, outsiderClientTester._id],
    status: 'in_progress',
  });

  const recipients = await getNotificationRecipients(
    'TICKET_COMMENTED', ticket, actor, { to: 'in_progress' },
  );
  const ids = recipients.map((r) => String(r.user._id));

  assert.ok(ids.includes(String(reporter._id)));
  assert.ok(ids.includes(String(allowedProjectClientUser._id)));
  assert.ok(ids.includes(String(companyWideClientUser._id)));
  assert.ok(!ids.includes(String(outsiderClientTester._id)));
});

test('cross-brand external recipient is excluded from ticket notifications', async () => {
  const actor = await user(ROLE_IDS.ADMIN);
  const reporter = await user(ROLE_IDS.DEVELOPER);
  const externalClient = await user(ROLE_IDS.CLIENT);

  const clientA = await Client.create({ name: `Scope A ${Date.now()}`, createdBy: actor._id });
  const clientB = await Client.create({ name: `Scope B ${Date.now()}`, createdBy: actor._id });
  const projectA = await Project.create({
    key: 'SCA',
    name: 'Scope A',
    client: clientA._id,
    createdBy: actor._id,
  });
  const projectB = await Project.create({
    key: 'SCB',
    name: 'Scope B',
    client: clientB._id,
    createdBy: actor._id,
  });

  await AccessAssignment.create({
    user: externalClient._id,
    role: ROLE_IDS.CLIENT,
    client: clientB._id,
    project: projectB._id,
    grantedBy: actor._id,
  });

  const ticket = await Ticket.create({
    ticketId: 'SCA-1',
    project: projectA._id,
    title: 'Do not leak across brands',
    createdBy: reporter._id,
    watchers: [externalClient._id],
    status: 'in_progress',
  });

  const recipients = await getNotificationRecipients(
    'TICKET_STAGE_CHANGED',
    ticket,
    actor,
    { to: 'in_progress' },
  );

  assert.ok(!recipients.some((r) => String(r.user._id) === String(externalClient._id)));
});

test('same-brand external recipient remains eligible for ticket notifications', async () => {
  const actor = await user(ROLE_IDS.ADMIN);
  const reporter = await user(ROLE_IDS.DEVELOPER);
  const externalClient = await user(ROLE_IDS.CLIENT_TESTER);

  const client = await Client.create({ name: `Scope Match ${Date.now()}`, createdBy: actor._id });
  const project = await Project.create({
    key: 'SCM',
    name: 'Scope Match',
    client: client._id,
    createdBy: actor._id,
  });

  await AccessAssignment.create({
    user: externalClient._id,
    role: ROLE_IDS.CLIENT_TESTER,
    client: client._id,
    project: project._id,
    grantedBy: actor._id,
  });

  const ticket = await Ticket.create({
    ticketId: 'SCM-1',
    project: project._id,
    title: 'Same-brand visibility',
    createdBy: reporter._id,
    watchers: [externalClient._id],
    status: 'in_progress',
  });

  const recipients = await getNotificationRecipients(
    'TICKET_STAGE_CHANGED',
    ticket,
    actor,
    { to: 'in_progress' },
  );

  assert.ok(recipients.some((r) => String(r.user._id) === String(externalClient._id)));
});

test('one person matching five rules appears exactly once', async () => {
  const everyone = await user(ROLE_IDS.PROJECT_ADMIN, 'Polymath');
  const actor = await user(ROLE_IDS.ADMIN);
  const team = await Team.create({ name: 'Squad', members: [everyone._id], createdBy: actor._id });
  const project = await Project.create({ key: 'WEB', name: 'Web App', createdBy: actor._id });

  const ticket = await Ticket.create({
    ticketId: 'WEB-1', project: project._id, title: 'x',
    createdBy: everyone._id, watchers: [everyone._id], assignedTo: everyone._id, team: team._id,
  });

  const recipients = await getNotificationRecipients(
    'TICKET_STAGE_CHANGED', ticket, actor, { to: 'live' },
  );

  assert.equal(recipients.filter((r) => String(r.user._id) === String(everyone._id)).length, 1);
});

test('a team-less ticket still notifies direct ticket audience', async () => {
  const reporter = await user();
  const watcher = await user();
  const assignee = await user(ROLE_IDS.DEVELOPER);
  const actor = await user(ROLE_IDS.ADMIN);
  const project = await Project.create({ key: 'WEB', name: 'Web App', createdBy: actor._id });
  const ticket = await Ticket.create({
    ticketId: 'WEB-1',
    project: project._id,
    title: 'x',
    createdBy: reporter._id,
    watchers: [watcher._id],
    assignedTo: assignee._id,
  });

  const recipients = await getNotificationRecipients(
    'TICKET_STAGE_CHANGED', ticket, actor, { to: 'in_progress' },
  );

  const ids = recipients.map((r) => String(r.user._id)).sort();
  assert.deepEqual(ids, [reporter._id, watcher._id, assignee._id].map(String).sort());
});

test('the actor is never told what they just did', async () => {
  const actor = await user(ROLE_IDS.ADMIN);
  const project = await Project.create({ key: 'WEB', name: 'Web App', createdBy: actor._id });
  const ticket = await Ticket.create({
    ticketId: 'WEB-1', project: project._id, title: 'x',
    createdBy: actor._id, watchers: [actor._id], assignedTo: actor._id,
  });

  const recipients = await getNotificationRecipients(
    'TICKET_STAGE_CHANGED', ticket, actor, { to: 'live' },
  );

  assert.equal(recipients.length, 0);
});

test('TICKET_MENTIONED only notifies visible mentioned users', async () => {
  const reporter = await user();
  const watcher = await user();
  const mentioned = await user();
  const actor = await user(ROLE_IDS.ADMIN);
  const team = await Team.create({ name: 'Mention Team', members: [mentioned._id], createdBy: actor._id });
  const project = await Project.create({ key: 'WEB', name: 'Web App', createdBy: actor._id });
  const ticket = await Ticket.create({
    ticketId: 'WEB-1', project: project._id, title: 'x',
    createdBy: reporter._id, team: team._id, watchers: [watcher._id],
  });

  const recipients = await getNotificationRecipients(
    'TICKET_MENTIONED', ticket, actor, { mentions: [mentioned._id, mentioned._id, actor._id] },
  );

  assert.equal(recipients.length, 1);
  assert.equal(String(recipients[0].user._id), String(mentioned._id));
  assert.ok(!recipients.some((r) => String(r.user._id) === String(watcher._id)));
  assert.ok(!recipients.some((r) => String(r.user._id) === String(reporter._id)));
});

test('inactive users are never notified', async () => {
  const actor = await user(ROLE_IDS.ADMIN);
  const gone = await User.create({
    name: 'Gone', email: 'gone@example.com', password: 'a-long-enough-password',
    status: 'inactive',
  });
  const project = await Project.create({ key: 'WEB', name: 'Web App', createdBy: actor._id });
  const ticket = await Ticket.create({
    ticketId: 'WEB-1', project: project._id, title: 'x', createdBy: gone._id,
  });

  const recipients = await getNotificationRecipients(
    'TICKET_STAGE_CHANGED', ticket, actor, { to: 'live' },
  );
  assert.equal(recipients.length, 0);
});

test('an unset preference resolves through the defaults table, not to true', async () => {
  const someone = await user();

  assert.equal(resolvePreference(someone, 'email', 'TICKET_COMMENTED'), false);
  assert.equal(resolvePreference(someone, 'email', 'TICKET_STAGE_CHANGED'), true);
  assert.equal(resolvePreference(someone, 'inApp', 'TICKET_COMMENTED'), true);
});

test('an explicit opt-out beats the default and is reported per channel', async () => {
  const someone = await user();
  someone.notificationPrefs.email.set('TICKET_STAGE_CHANGED', false);
  await someone.save();

  const actor = await user(ROLE_IDS.ADMIN);
  const team = await Team.create({ name: 'Prefs Team', members: [someone._id], createdBy: actor._id });
  const project = await Project.create({ key: 'WEB', name: 'Web App', createdBy: actor._id });
  const ticket = await Ticket.create({
    ticketId: 'WEB-1', project: project._id, team: team._id, title: 'x', createdBy: someone._id,
  });

  const [recipient] = await getNotificationRecipients(
    'TICKET_STAGE_CHANGED', ticket, actor, { to: 'live' },
  );

  assert.equal(recipient.channels.email, false);
  assert.equal(recipient.channels.inApp, true);
});

test('in-app rows are written once per recipient who allows the channel', async () => {
  const reporter = await user();
  const muted = await user();
  muted.notificationPrefs.inApp.set('TICKET_STAGE_CHANGED', false);
  await muted.save();

  const actor = await user(ROLE_IDS.ADMIN);
  const team = await Team.create({ name: 'InApp Team', createdBy: actor._id });
  const project = await Project.create({ key: 'WEB', name: 'Web App', createdBy: actor._id });
  const ticket = await Ticket.create({
    ticketId: 'WEB-1', project: project._id, title: 'Broken login',
    createdBy: reporter._id, team: team._id, watchers: [muted._id],
  });

  const recipients = await getNotificationRecipients(
    'TICKET_STAGE_CHANGED', ticket, actor, { to: 'live' },
  );
  await createInAppNotifications('TICKET_STAGE_CHANGED', ticket, recipients, {
    frontendBaseUrl: 'http://localhost:3000',
  });

  const rows = await Notification.find({});
  assert.equal(rows.length, 1);
  assert.equal(String(rows[0].user), String(reporter._id));
  assert.equal(rows[0].link, `http://localhost:3000/tickets?ticket=WEB-1&project=${project._id}`);
});
