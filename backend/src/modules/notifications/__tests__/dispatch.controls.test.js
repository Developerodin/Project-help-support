import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS } from '@pms/shared';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import Ticket from '../../tickets/ticket.model.js';
import Notification from '../notification.model.js';
import EmailLog from '../emailLog.model.js';
import { dispatchTicketEvent } from '../dispatch.js';
import { updateTicketSettings } from '../ticket-settings.service.js';

withMemoryDb();

const config = {
  frontendBaseUrl: 'http://localhost:3000',
  features: { email: true },
  email: { from: 'PMS <pms@example.com>' },
};

const user = (role = ROLE_IDS.DEVELOPER, prefs = {}) => User.create({
  name: role, email: `${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password', status: 'active', role, notificationPrefs: prefs,
});

async function fixture(reporterPrefs = {}) {
  const reporter = await user(ROLE_IDS.DEVELOPER, reporterPrefs);
  const actor = await user(ROLE_IDS.ADMIN);
  const project = await Project.create({ key: 'WEB', name: 'Web App', createdBy: actor._id });
  const ticket = await Ticket.create({
    ticketId: 'WEB-1', project: project._id, title: 'Broken login', createdBy: reporter._id,
  });
  return { reporter, actor, ticket };
}

function harness() {
  const pushed = [];
  const sent = [];
  return {
    pushed,
    sent,
    deps: {
      transport: { sendMail: async (m) => { sent.push(m); return {}; } },
      sendPush: async (rows) => { pushed.push(...rows.map((row) => String(row.user))); },
    },
  };
}

const HOUR = 60 * 60 * 1000;
/** Quiet hours (in UTC) that are on right now and end in an hour. */
function quietNow({ allowUrgent }) {
  const hhmm = (date) => date.toISOString().slice(11, 16);
  return {
    timeZone: 'UTC',
    quietHours: {
      enabled: true, start: hhmm(new Date(Date.now() - HOUR)), end: hhmm(new Date(Date.now() + HOUR)), allowUrgent,
    },
  };
}

const stageMove = { type: 'TICKET_STAGE_CHANGED', from: 'pending', to: 'in_progress' };

test('a muted ticket sends nothing routine, on any channel', async () => {
  const { reporter, actor, ticket } = await fixture();
  await updateTicketSettings(reporter, String(ticket._id), { muted: true });
  const { pushed, deps } = harness();

  await dispatchTicketEvent({ event: stageMove, ticket, actor, config, deps });

  assert.equal(await Notification.countDocuments({ user: reporter._id }), 0);
  assert.equal(await EmailLog.countDocuments({ recipientUserId: reporter._id }), 0);
  assert.deepEqual(pushed, []);
});

test('a muted ticket still delivers a mention and an assignment to you', async () => {
  const { reporter, actor, ticket } = await fixture();
  await updateTicketSettings(reporter, String(ticket._id), { muted: true });
  const { sent, pushed, deps } = harness();

  await dispatchTicketEvent({
    event: { type: 'TICKET_COMMENTED', mentions: [reporter._id] }, ticket, actor, config, deps,
  });
  await Ticket.updateOne({ _id: ticket._id }, { $set: { assignedTo: reporter._id } });
  await dispatchTicketEvent({
    event: { type: 'TICKET_ASSIGNED' }, ticket: await Ticket.findById(ticket._id), actor, config, deps,
  });

  const rows = await Notification.find({ user: reporter._id });
  assert.deepEqual(rows.map((r) => r.event).sort(), ['TICKET_ASSIGNED', 'TICKET_MENTIONED']);
  assert.equal(sent.length, 2);
  assert.equal(pushed.length, 2);
});

test('following a ticket makes its routine events reach you', async () => {
  const { actor, ticket } = await fixture();
  const follower = await user(ROLE_IDS.ADMIN);
  const { deps } = harness();

  await dispatchTicketEvent({ event: stageMove, ticket, actor, config, deps });
  assert.equal(await Notification.countDocuments({ user: follower._id }), 0);

  const settings = await updateTicketSettings(follower, String(ticket._id), { following: true });
  assert.deepEqual(settings, {
    muted: false, following: true, canFollow: true, inAudienceByRole: false,
  });
  await dispatchTicketEvent({ event: stageMove, ticket: await Ticket.findById(ticket._id), actor, config, deps });

  assert.equal(await Notification.countDocuments({ user: follower._id }), 1);
});

test('quiet hours: routine email waits for the end, routine push is skipped, in-app is written', async () => {
  const { reporter, actor, ticket } = await fixture(quietNow({ allowUrgent: true }));
  const { pushed, deps } = harness();

  await dispatchTicketEvent({ event: stageMove, ticket, actor, config, deps });

  assert.equal(await Notification.countDocuments({ user: reporter._id }), 1);
  assert.deepEqual(pushed, []);
  const row = await EmailLog.findOne({ recipientUserId: reporter._id });
  assert.equal(row.status, 'queued');
  assert.ok(row.sendAfter > new Date(Date.now() + 50 * 60 * 1000), 'held until quiet hours end');
});

test('quiet hours with urgent allowed: a mention is pushed and emailed now', async () => {
  const { reporter, actor, ticket } = await fixture(quietNow({ allowUrgent: true }));
  const { sent, pushed, deps } = harness();

  await dispatchTicketEvent({
    event: { type: 'TICKET_COMMENTED', mentions: [reporter._id] }, ticket, actor, config, deps,
  });

  assert.deepEqual(pushed, [String(reporter._id)]);
  assert.equal(sent.length, 1);
});

test('quiet hours without urgent: a mention is neither pushed nor emailed until they end', async () => {
  const { reporter, actor, ticket } = await fixture(quietNow({ allowUrgent: false }));
  const { sent, pushed, deps } = harness();

  await dispatchTicketEvent({
    event: { type: 'TICKET_COMMENTED', mentions: [reporter._id] }, ticket, actor, config, deps,
  });

  assert.equal(await Notification.countDocuments({ user: reporter._id }), 1);
  assert.deepEqual(pushed, []);
  assert.equal(sent.length, 0);
  const row = await EmailLog.findOne({ recipientUserId: reporter._id });
  assert.equal(row.status, 'queued');
  assert.equal(row.batch[0].urgent, true);
  assert.ok(row.sendAfter > new Date(Date.now() + 50 * 60 * 1000));
});

test('paused email: no ticket email is queued or sent, in-app is untouched', async () => {
  const { reporter, actor, ticket } = await fixture({ emailPaused: true });
  const { sent, deps } = harness();

  await dispatchTicketEvent({ event: stageMove, ticket, actor, config, deps });
  await dispatchTicketEvent({
    event: { type: 'TICKET_COMMENTED', mentions: [reporter._id] }, ticket, actor, config, deps,
  });

  assert.equal(await EmailLog.countDocuments({}), 0);
  assert.equal(sent.length, 0);
  assert.equal(await Notification.countDocuments({ user: reporter._id }), 2);
});
