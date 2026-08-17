import test from 'node:test';
import assert from 'node:assert/strict';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Team from '../../teams/team.model.js';
import Project from '../../projects/project.model.js';
import Ticket from '../../tickets/ticket.model.js';
import Notification from '../notification.model.js';
import { getNotificationRecipients, resolvePreference } from '../recipients.js';
import { createInAppNotifications } from '../notification.service.js';

withMemoryDb();

const user = (role = 'member', name = role) => User.create({
  name, email: `${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password', status: 'active', role,
});

test('the always-set is reporter, watchers, assignee, tester and team members', async () => {
  const reporter = await user();
  const watcher = await user();
  const assignee = await user('developer');
  const tester = await user('qa');
  const member = await user('developer');
  const actor = await user('admin');

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
  const assignee = await user('developer');
  const actor = await user('admin');
  const project = await Project.create({ key: 'WEB', name: 'Web App', createdBy: actor._id });
  const ticket = await Ticket.create({
    ticketId: 'WEB-1', project: project._id, title: 'x',
    createdBy: reporter._id, assignedTo: assignee._id, status: 'live',
  });

  const recipients = await getNotificationRecipients(
    'TICKET_STAGE_CHANGED', ticket, actor, { to: 'live' },
  );

  assert.ok(recipients.some((r) => String(r.user._id) === String(assignee._id)));
});

test('QA stages broadcast to every qa user; release stages to leads and admins', async () => {
  const reporter = await user();
  const qa = await user('qa');
  const lead = await user('lead');
  const actor = await user('admin');
  const project = await Project.create({ key: 'WEB', name: 'Web App', createdBy: actor._id });
  const ticket = await Ticket.create({
    ticketId: 'WEB-1', project: project._id, title: 'x', createdBy: reporter._id,
  });

  const toQa = await getNotificationRecipients(
    'TICKET_STAGE_CHANGED', ticket, actor, { to: 'ready_qa' },
  );
  assert.ok(toQa.some((r) => String(r.user._id) === String(qa._id)));

  const toRelease = await getNotificationRecipients(
    'TICKET_STAGE_CHANGED', ticket, actor, { to: 'live' },
  );
  assert.ok(toRelease.some((r) => String(r.user._id) === String(lead._id)));
  assert.ok(!toRelease.some((r) => String(r.user._id) === String(qa._id)));
});

test('one person matching five rules appears exactly once', async () => {
  const everyone = await user('lead', 'Polymath');
  const actor = await user('admin');
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

test('a team-less ticket falls back to the project\'s assigned team', async () => {
  const reporter = await user();
  const teammate = await user('developer');
  const actor = await user('admin');
  const team = await Team.create({ name: 'Web Team', members: [teammate._id], createdBy: actor._id });
  const project = await Project.create({
    key: 'WEB', name: 'Web App', createdBy: actor._id, team: team._id,
  });
  const ticket = await Ticket.create({
    ticketId: 'WEB-1', project: project._id, title: 'x', createdBy: reporter._id,
  });

  const recipients = await getNotificationRecipients(
    'TICKET_STAGE_CHANGED', ticket, actor, { to: 'in_progress' },
  );

  assert.ok(recipients.some((r) => String(r.user._id) === String(teammate._id)));
});

test('the actor is never told what they just did', async () => {
  const actor = await user('admin');
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

test('TICKET_MENTIONED reaches only the mentioned users', async () => {
  const reporter = await user();
  const watcher = await user();
  const mentioned = await user();
  const actor = await user('admin');
  const project = await Project.create({ key: 'WEB', name: 'Web App', createdBy: actor._id });
  const ticket = await Ticket.create({
    ticketId: 'WEB-1', project: project._id, title: 'x',
    createdBy: reporter._id, watchers: [watcher._id],
  });

  const recipients = await getNotificationRecipients(
    'TICKET_MENTIONED', ticket, actor, { mentions: [mentioned._id] },
  );

  assert.deepEqual(recipients.map((r) => String(r.user._id)), [String(mentioned._id)]);
});

test('inactive users are never notified', async () => {
  const actor = await user('admin');
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

  // The two high-volume events default email OFF.
  assert.equal(resolvePreference(someone, 'email', 'TICKET_COMMENTED'), false);
  assert.equal(resolvePreference(someone, 'email', 'TICKET_STAGE_CHANGED'), true);
  assert.equal(resolvePreference(someone, 'inApp', 'TICKET_COMMENTED'), true);
});

test('an explicit opt-out beats the default and is reported per channel', async () => {
  const someone = await user();
  someone.notificationPrefs.email.set('TICKET_STAGE_CHANGED', false);
  await someone.save();

  const actor = await user('admin');
  const project = await Project.create({ key: 'WEB', name: 'Web App', createdBy: actor._id });
  const ticket = await Ticket.create({
    ticketId: 'WEB-1', project: project._id, title: 'x', createdBy: someone._id,
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

  const actor = await user('admin');
  const project = await Project.create({ key: 'WEB', name: 'Web App', createdBy: actor._id });
  const ticket = await Ticket.create({
    ticketId: 'WEB-1', project: project._id, title: 'Broken login',
    createdBy: reporter._id, watchers: [muted._id],
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
  assert.match(rows[0].link, /\/tickets\?ticket=WEB-1$/);
});
