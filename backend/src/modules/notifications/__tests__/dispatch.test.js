import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS } from '@pms/shared';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import Client from '../../clients/client.model.js';
import Team from '../../teams/team.model.js';
import AccessAssignment from '../../access/accessAssignment.model.js';
import Ticket from '../../tickets/ticket.model.js';
import Notification from '../notification.model.js';
import EmailLog from '../emailLog.model.js';
import { dispatchTicketEvent, buildInviteDeliverer } from '../dispatch.js';
import { flushDueEmailBatches } from '../email.service.js';

withMemoryDb();

const config = {
  frontendBaseUrl: 'http://localhost:3000',
  features: { email: true },
  email: { from: 'PMS <pms@example.com>' },
};
const attachmentConfig = {
  ...config,
  features: { ...config.features, attachments: true },
  storage: {
    region: 'us-east-1',
    accessKeyId: 'test-access-key',
    secretAccessKey: 'test-secret-key',
    bucket: 'test-branding-bucket',
  },
};

const user = (role = ROLE_IDS.DEVELOPER) => User.create({
  name: role, email: `${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password', status: 'active', role,
});

async function fixture() {
  const reporter = await user();
  const actor = await user(ROLE_IDS.ADMIN);
  const team = await Team.create({ name: 'Core Team', createdBy: actor._id });
  const project = await Project.create({ key: 'WEB', name: 'Web App', createdBy: actor._id });
  const ticket = await Ticket.create({
    ticketId: 'WEB-1', project: project._id, team: team._id, title: 'Broken login', createdBy: reporter._id,
  });
  return { reporter, actor, ticket, project, team };
}

const transport = () => ({ sendMail: async (m) => ({ messageId: m.messageId }) });

/** Routine events wait in a batch; send whatever is queued as if the window had passed. */
const flush = (cfg, mailer) => flushDueEmailBatches(cfg, { transport: mailer }, {
  now: new Date(Date.now() + 60 * 60 * 1000),
});

test('one dispatch produces one in-app row and one email row per recipient', async () => {
  const { actor, ticket } = await fixture();

  await dispatchTicketEvent({
    event: { type: 'TICKET_STAGE_CHANGED', from: 'pending', to: 'live' },
    ticket, actor, config, deps: { transport: transport() },
  });

  assert.equal(await Notification.countDocuments({}), 1);
  assert.equal(await EmailLog.countDocuments({}), 1);
});

test('a mail failure is logged and swallowed Ã¢â‚¬â€ the caller never sees it', async () => {
  const { actor, ticket } = await fixture();
  const exploding = { sendMail: async () => { throw new Error('smtp down'); } };

  await dispatchTicketEvent({
    event: { type: 'TICKET_STAGE_CHANGED', from: 'pending', to: 'live' },
    ticket, actor, config, deps: { transport: exploding },
  });
  await flush(config, exploding);

  // The in-app row still exists, and the email row records the failure.
  assert.equal(await Notification.countDocuments({}), 1);
  assert.equal((await EmailLog.findOne({})).status, 'failed');
});

test('an unknown event type produces nothing and does not throw', async () => {
  const { actor, ticket } = await fixture();

  await dispatchTicketEvent({
    event: { type: 'NOT_AN_EVENT', to: 'live' },
    ticket, actor, config, deps: { transport: transport() },
  });

  assert.equal(await Notification.countDocuments({}), 0);
});

test('a comment dispatch notifies the always-set, and a mention only the mentioned', async () => {
  const { reporter, actor, ticket, team } = await fixture();
  const mentioned = await user();
  // Only someone who can open the ticket hears about a mention on it.
  await Team.updateOne({ _id: team._id }, { $push: { members: mentioned._id } });

  await dispatchTicketEvent({
    event: { type: 'TICKET_COMMENTED', commentId: 'x', mentions: [String(mentioned._id)] },
    ticket, actor, config, deps: { transport: transport() },
  });

  const rows = await Notification.find({});
  const byEvent = rows.reduce((acc, r) => {
    acc[r.event] = (acc[r.event] || []).concat(String(r.user));
    return acc;
  }, {});

  assert.deepEqual(byEvent.TICKET_COMMENTED, [String(reporter._id)]);
  assert.deepEqual(byEvent.TICKET_MENTIONED, [String(mentioned._id)]);
});

test('TICKET_ESTIMATE_SET dispatch produces an in-app row for the reporter', async () => {
  const { actor, ticket } = await fixture();

  await dispatchTicketEvent({
    event: { type: 'TICKET_ESTIMATE_SET' },
    ticket, actor, config, deps: { transport: transport() },
  });

  assert.equal(await Notification.countDocuments({ event: 'TICKET_ESTIMATE_SET' }), 1);
});
test('invite deliverer sends accept link with token', async () => {
  const sent = [];
  const transport = { sendMail: async (m) => { sent.push(m); return {}; } };
  const deliver = buildInviteDeliverer(config, { transport });

  await deliver({ user: { email: 'ada@example.com', name: 'Ada' }, inviteToken: 'abc123' });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].to[0], 'ada@example.com');
  assert.match(sent[0].text, /invite\/accept\?token=abc123/);
  assert.match(sent[0].html, /Accept invite/);
  assert.match(sent[0].subject, /invited to ProwPlus/i);
});

test('invite deliverer skips send when email is disabled', async () => {
  const sent = [];
  const transport = { sendMail: async (m) => { sent.push(m); return {}; } };
  const deliver = buildInviteDeliverer(
    { ...config, features: { email: false }, email: null },
    { transport },
  );

  await deliver({ user: { email: 'ada@example.com' }, inviteToken: 'abc123' });

  assert.equal(sent.length, 0);
});

test('stage-change email context strips note/reason for an external recipient but keeps it for an internal one', async () => {
  const admin = await user(ROLE_IDS.ADMIN);
  const externalTester = await User.create({
    name: 'Client Tester', email: 'tester@example.com', password: 'a-long-enough-password',
    status: 'active', role: ROLE_IDS.CLIENT_TESTER,
  });
  const internalDev = await user(ROLE_IDS.DEVELOPER);
  const client = await Client.create({
    name: `Client ${Date.now()}`,
    logoKey: 'companies/client-logo.png',
    createdBy: admin._id,
  });
  const team = await Team.create({ name: 'Scope Team', members: [internalDev._id], createdBy: admin._id });
  const project = await Project.create({
    key: 'WEB',
    name: 'Web App',
    client: client._id,
    team: team._id,
    createdBy: admin._id,
  });
  await AccessAssignment.create({
    user: externalTester._id,
    role: ROLE_IDS.CLIENT_TESTER,
    client: client._id,
    project: project._id,
    grantedBy: admin._id,
  });
  const ticket = await Ticket.create({
    ticketId: 'WEB-1', project: project._id, title: 'Broken login',
    createdBy: externalTester._id, assignedTo: internalDev._id, team: team._id,
  });

  const sent = [];
  const transport = { sendMail: async (m) => { sent.push(m); return {}; } };

  await dispatchTicketEvent({
    event: {
      type: 'TICKET_STAGE_CHANGED', from: 'pending', to: 'closed',
      reason: 'Duplicate of WEB-99',
    },
    ticket, actor: admin, config: attachmentConfig, deps: { transport },
  });
  await flush(attachmentConfig, transport);

  const toInternal = sent.find((m) => m.to[0] === internalDev.email);
  const toExternal = sent.find((m) => m.to[0] === externalTester.email);

  assert.ok(toInternal, 'the internal recipient got an email');
  assert.ok(toExternal, 'the external recipient still hears about the stage move');
  assert.match(toInternal.text, /Duplicate of WEB-99/);
  assert.doesNotMatch(toExternal.text, /Duplicate of WEB-99/);
});

test('an internal comment produces no notification for the external ticket creator, on either channel', async () => {
  const admin = await user(ROLE_IDS.ADMIN);
  const externalTester = await User.create({
    name: 'Client Tester', email: 'tester2@example.com', password: 'a-long-enough-password',
    status: 'active', role: ROLE_IDS.CLIENT_TESTER,
  });
  const client = await Client.create({ name: `Client ${Date.now()}`, createdBy: admin._id });
  const team = await Team.create({ name: 'Internal Comments Team', createdBy: admin._id });
  const project = await Project.create({
    key: 'WEB',
    name: 'Web App',
    client: client._id,
    team: team._id,
    createdBy: admin._id,
  });
  await AccessAssignment.create({
    user: externalTester._id,
    role: ROLE_IDS.CLIENT_TESTER,
    client: client._id,
    project: project._id,
    grantedBy: admin._id,
  });
  const ticket = await Ticket.create({
    ticketId: 'WEB-2', project: project._id, title: 'Broken login',
    createdBy: externalTester._id, team: team._id,
    comments: [
      { content: 'Internal note', commentedBy: admin._id, internal: true, createdAt: new Date() },
    ],
  });
  const commentId = ticket.comments[0]._id;

  const sent = [];
  const transport = { sendMail: async (m) => { sent.push(m); return {}; } };

  await dispatchTicketEvent({
    event: { type: 'TICKET_COMMENTED', commentId: String(commentId) },
    ticket, actor: admin, config, deps: { transport },
  });

  assert.equal(sent.length, 0, 'no email reached the external creator');
  assert.equal(
    await Notification.countDocuments({ user: externalTester._id }),
    0,
    'no in-app row was written for the external creator either',
  );
});

test('an external watcher gets a public-comment notification but not an internal one', async () => {
  const admin = await user(ROLE_IDS.ADMIN);
  const reporter = await user();
  const externalWatcher = await User.create({
    name: 'Client', email: 'watcher@example.com', password: 'a-long-enough-password',
    status: 'active', role: ROLE_IDS.CLIENT,
  });
  const client = await Client.create({ name: `Client ${Date.now()}`, createdBy: admin._id });
  const team = await Team.create({ name: 'Watcher Team', createdBy: admin._id });
  const project = await Project.create({
    key: 'WEB',
    name: 'Web App',
    client: client._id,
    team: team._id,
    createdBy: admin._id,
  });
  await AccessAssignment.create({
    user: externalWatcher._id,
    role: ROLE_IDS.CLIENT,
    client: client._id,
    project: project._id,
    grantedBy: admin._id,
  });
  const ticket = await Ticket.create({
    ticketId: 'WEB-3', project: project._id, title: 'Broken login',
    createdBy: reporter._id,
    team: team._id,
    watchers: [externalWatcher._id],
    comments: [
      { content: 'Public update', commentedBy: admin._id, internal: false, createdAt: new Date() },
      { content: 'Staff only', commentedBy: admin._id, internal: true, createdAt: new Date() },
    ],
  });
  const publicId = ticket.comments[0]._id;
  const internalId = ticket.comments[1]._id;
  const transport = { sendMail: async () => ({}) };

  await dispatchTicketEvent({
    event: { type: 'TICKET_COMMENTED', commentId: String(publicId) },
    ticket, actor: admin, config, deps: { transport },
  });
  assert.equal(
    await Notification.countDocuments({ user: externalWatcher._id, event: 'TICKET_COMMENTED' }),
    1,
  );

  await dispatchTicketEvent({
    event: { type: 'TICKET_COMMENTED', commentId: String(internalId) },
    ticket, actor: admin, config, deps: { transport },
  });
  assert.equal(
    await Notification.countDocuments({ user: externalWatcher._id, event: 'TICKET_COMMENTED' }),
    1,
    'internal comment must not add another notification for the external watcher',
  );
});

test('ticket email uses the company brand name and inline company logo', async () => {
  const actor = await user(ROLE_IDS.ADMIN);
  const reporter = await user();
  const team = await Team.create({ name: 'Brand Team', createdBy: actor._id });
  const client = await Client.create({
    name: 'Acme Labs',
    logoKey: 'companies/acme-logo.png',
    createdBy: actor._id,
  });
  const project = await Project.create({
    key: 'ACM',
    name: 'Acme Portal',
    brand: 'Acme Labs',
    client: client._id,
    team: team._id,
    createdBy: actor._id,
  });
  const ticket = await Ticket.create({
    ticketId: 'ACM-1',
    project: project._id,
    team: team._id,
    title: 'Brand mismatch in notifications',
    createdBy: reporter._id,
  });

  const sent = [];
  const transport = { sendMail: async (m) => { sent.push(m); return {}; } };

  await dispatchTicketEvent({
    event: { type: 'TICKET_STAGE_CHANGED', from: 'pending', to: 'live' },
    ticket,
    actor,
    config: attachmentConfig,
    deps: { transport },
  });
  await flush(attachmentConfig, transport);

  assert.equal(sent.length, 1);
  assert.match(sent[0].html, /Acme Labs PMS/);
  assert.equal(sent[0].attachments?.[0]?.cid, 'brand-mark');
  assert.match(String(sent[0].attachments?.[0]?.path ?? ''), /acme-logo\.png/);
});

test('ticket email falls back to default brand when company logo is missing', async () => {
  const actor = await user(ROLE_IDS.ADMIN);
  const reporter = await user();
  const team = await Team.create({ name: 'Fallback Team', createdBy: actor._id });
  const client = await Client.create({
    name: 'No Logo Company',
    createdBy: actor._id,
  });
  const project = await Project.create({
    key: 'NLC',
    name: 'No Logo Portal',
    brand: 'No Logo Company',
    client: client._id,
    team: team._id,
    createdBy: actor._id,
  });
  const ticket = await Ticket.create({
    ticketId: 'NLC-1',
    project: project._id,
    team: team._id,
    title: 'Fallback branding check',
    createdBy: reporter._id,
  });

  const sent = [];
  const transport = { sendMail: async (m) => { sent.push(m); return {}; } };

  await dispatchTicketEvent({
    event: { type: 'TICKET_STAGE_CHANGED', from: 'pending', to: 'live' },
    ticket,
    actor,
    config: attachmentConfig,
    deps: { transport },
  });
  await flush(attachmentConfig, transport);

  assert.equal(sent.length, 1);
  assert.match(sent[0].html, /No Logo Company PMS/);
  assert.equal(sent[0].attachments?.[0]?.cid, 'brand-mark');
  assert.equal(sent[0].attachments?.[0]?.path, undefined);
  assert.ok(Buffer.isBuffer(sent[0].attachments?.[0]?.content));
});




