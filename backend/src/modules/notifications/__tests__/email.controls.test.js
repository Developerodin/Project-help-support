import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS } from '@pms/shared';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import Ticket from '../../tickets/ticket.model.js';
import EmailLog from '../emailLog.model.js';
import TicketMute from '../ticketMute.model.js';
import {
  enqueueTicketEmail, flushDueEmailBatches, retryPendingEmails, sendUrgentTicketEmail,
} from '../email.service.js';
import { verifyUnsubscribeToken } from '../unsubscribe.js';

withMemoryDb();

const MIN = 60 * 1000;
const config = {
  frontendBaseUrl: 'http://localhost:3000',
  apiPublicUrl: 'https://api.example.com',
  jwt: { secret: 'a-test-secret-that-is-long-enough-to-sign' },
  features: { email: true },
  email: { from: 'PMS <pms@example.com>', batchWindowMs: 5 * MIN, batchMaxMs: 15 * MIN },
};
const LATER = () => new Date(Date.now() + 26 * 60 * MIN);

function mailbox() {
  const sent = [];
  return { sent, transport: { sendMail: async (m) => { sent.push(m); return {}; } } };
}

async function reader(prefs = {}) {
  return User.create({
    name: 'Ada', email: `${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-long-enough-password', status: 'active', role: ROLE_IDS.ADMIN,
    notificationPrefs: { timeZone: 'Asia/Kolkata', ...prefs },
  });
}

async function tickets(owner, count) {
  const project = await Project.create({ key: 'WEB', name: 'Web App', createdBy: owner._id });
  return Promise.all(Array.from({ length: count }, (_, i) => Ticket.create({
    ticketId: `WEB-${i + 1}`, project: project._id, title: `Ticket ${i + 1}`, createdBy: owner._id, status: 'in_progress',
  })));
}

const closed = { event: 'TICKET_CLOSED', context: { actorName: 'Ravi' } };

test('an hourly reader\'s batch is held for the top of the hour in their zone', async () => {
  const user = await reader({ emailFrequency: 'hourly' });
  const [ticket] = await tickets(user, 1);
  const now = new Date('2026-09-25T10:10:00Z'); // 15:40 IST

  const row = await enqueueTicketEmail(user._id, ticket, closed, config, { now, recipient: user });

  assert.equal(row.sendAfter.toISOString(), '2026-09-25T10:30:00.000Z');
  assert.equal(row.batchDeadline.toISOString(), '2026-09-25T10:30:00.000Z');
});

test('a daily summary covers every due ticket in one unthreaded email', async () => {
  const user = await reader({ emailFrequency: 'daily' });
  const all = await tickets(user, 3);
  for (const ticket of all) await enqueueTicketEmail(user._id, ticket, closed, config, { recipient: user });
  const { sent, transport } = mailbox();

  const result = await flushDueEmailBatches(config, { transport }, { now: LATER() });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, 'Your daily summary: 3 tickets updated');
  assert.equal(sent[0].inReplyTo, undefined);
  for (const ticket of all) assert.match(sent[0].text, new RegExp(`${ticket.ticketId}: ${ticket.title}`));
  assert.equal(result.sent, 3);
  const rows = await EmailLog.find({});
  assert.deepEqual(rows.map((r) => r.status).sort(), ['sent', 'sent', 'sent']);
  assert.equal(rows.filter((r) => r.template === 'ticket_summary').length, 1);
  assert.equal(rows.filter((r) => r.mergedInto).length, 2);
});

test('an hourly summary still applies the per-item checks', async () => {
  const user = await reader({ emailFrequency: 'hourly' });
  const [kept, muted, gone] = await tickets(user, 3);
  for (const ticket of [kept, muted, gone]) {
    await enqueueTicketEmail(user._id, ticket, closed, config, { recipient: user });
  }
  await TicketMute.create({ user: user._id, ticket: muted._id });
  await Ticket.deleteOne({ _id: gone._id });
  const { sent, transport } = mailbox();

  await flushDueEmailBatches(config, { transport }, { now: LATER() });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, 'Hourly summary: 1 ticket updated');
  assert.doesNotMatch(sent[0].text, /WEB-2|WEB-3/);
  assert.equal(await EmailLog.countDocuments({ status: 'skipped' }), 2);
});

test('two flushers at once never send a ticket twice', async () => {
  const user = await reader({ emailFrequency: 'daily' });
  const all = await tickets(user, 4);
  for (const ticket of all) await enqueueTicketEmail(user._id, ticket, closed, config, { recipient: user });
  // Due now, in real time: a `now` in the future would also make each
  // flusher's fresh claims look stale (past the grace period) to the other.
  await EmailLog.updateMany({}, { $set: { sendAfter: new Date(Date.now() - MIN) } });
  const { sent, transport } = mailbox();

  await Promise.all([
    flushDueEmailBatches(config, { transport }),
    flushDueEmailBatches(config, { transport }),
  ]);

  const mentions = all.map((t) => sent.filter((m) => m.text.includes(`${t.ticketId}:`)).length);
  assert.deepEqual(mentions, [1, 1, 1, 1]);
  assert.equal(await EmailLog.countDocuments({ status: 'sent' }), 4);
});

test('a failed summary is retried as the same one email, not per ticket', async () => {
  const user = await reader({ emailFrequency: 'daily' });
  const all = await tickets(user, 2);
  for (const ticket of all) await enqueueTicketEmail(user._id, ticket, closed, config, { recipient: user });
  await flushDueEmailBatches(config, { transport: { sendMail: async () => { throw new Error('down'); } } }, { now: LATER() });
  await EmailLog.updateMany({}, { $set: { lastAttemptAt: new Date(Date.now() - 60 * MIN) } });
  const { sent, transport } = mailbox();

  await retryPendingEmails(config, { transport }, { graceMs: 1000 });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, 'Your daily summary: 2 tickets updated');
  assert.ok(sent[0].headers['List-Unsubscribe']);
});

test('every ticket email carries one-click unsubscribe headers and footer links, retries included', async () => {
  const user = await reader();
  const [ticket] = await tickets(user, 1);
  await enqueueTicketEmail(user._id, ticket, closed, config);
  await flushDueEmailBatches(config, { transport: { sendMail: async () => { throw new Error('down'); } } }, { now: LATER() });
  const failed = await EmailLog.findOneAndUpdate({}, { $set: { lastAttemptAt: new Date(Date.now() - 60 * MIN) } }, { new: true });
  const { sent, transport } = mailbox();

  await retryPendingEmails(config, { transport }, { graceMs: 1000 });
  await sendUrgentTicketEmail('TICKET_MENTIONED', ticket, [{ user, channels: { email: true } }], { actorName: 'Mira' }, config, { transport });

  assert.equal(sent.length, 2);
  for (const message of sent) {
    const header = message.headers['List-Unsubscribe'];
    assert.match(header, /^<https:\/\/api\.example\.com\/v1\/notifications\/email\/unsubscribe\?token=/);
    assert.equal(message.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    const token = decodeURIComponent(header.match(/token=([^>]+)>/)[1]);
    assert.equal(verifyUnsubscribeToken(token, config), String(user._id));
    assert.match(message.text, /Manage notifications: http:\/\/localhost:3000\/settings\/notifications/);
    assert.match(message.text, /Unsubscribe: http:\/\/localhost:3000\/unsubscribe\?token=/);
    assert.match(message.html, /Manage notifications<\/a>/);
  }
  assert.equal(sent[0].headers['List-Unsubscribe'], failed.listUnsubscribe);
});

test('without a public API URL the header is left off but the footer links stay', async () => {
  const user = await reader();
  const [ticket] = await tickets(user, 1);
  const { sent, transport } = mailbox();

  await sendUrgentTicketEmail('TICKET_MENTIONED', ticket, [{ user, channels: { email: true } }], { actorName: 'Mira' }, {
    ...config, apiPublicUrl: null,
  }, { transport });

  assert.equal(sent[0].headers, undefined);
  assert.match(sent[0].text, /Unsubscribe: http:\/\/localhost:3000\/unsubscribe\?token=/);
});

test('a reader who paused email by send time has their queued batch dropped', async () => {
  const user = await reader();
  const [ticket] = await tickets(user, 1);
  await enqueueTicketEmail(user._id, ticket, closed, config);
  await User.updateOne({ _id: user._id }, { $set: { 'notificationPrefs.emailPaused': true } });
  const { sent, transport } = mailbox();

  await flushDueEmailBatches(config, { transport }, { now: LATER() });

  assert.equal(sent.length, 0);
  const row = await EmailLog.findOne({});
  assert.equal(row.status, 'skipped');
  assert.equal(row.error, 'Recipient paused ticket email');
});

test('a ticket muted after its batch was queued drops the routine items, keeps urgent ones', async () => {
  const user = await reader();
  const [ticket] = await tickets(user, 1);
  await enqueueTicketEmail(user._id, ticket, closed, config);
  await enqueueTicketEmail(user._id, ticket, {
    event: 'TICKET_MENTIONED', context: { actorName: 'Mira', commentAuthor: 'Mira', comment: 'ping' }, urgent: true,
  }, config);
  await TicketMute.create({ user: user._id, ticket: ticket._id });
  const { sent, transport } = mailbox();

  await flushDueEmailBatches(config, { transport }, { now: LATER() });

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /^Mira mentioned you/);
  assert.doesNotMatch(sent[0].text, /closed this ticket/);
});

test('a quiet-hours hold moves an open batch later, never earlier', async () => {
  const user = await reader();
  const [ticket] = await tickets(user, 1);
  const t0 = new Date('2026-09-25T16:00:00Z');
  const quietEnd = new Date('2026-09-26T02:30:00Z');

  await enqueueTicketEmail(user._id, ticket, closed, config, { now: t0 });
  let row = await enqueueTicketEmail(user._id, ticket, closed, config, { now: t0, holdUntil: quietEnd });
  assert.equal(row.sendAfter.toISOString(), quietEnd.toISOString());
  assert.equal(row.batchDeadline.toISOString(), quietEnd.toISOString());

  row = await enqueueTicketEmail(user._id, ticket, closed, config, {
    now: t0, holdUntil: new Date('2026-09-25T17:00:00Z'),
  });
  assert.equal(row.sendAfter.toISOString(), quietEnd.toISOString());
  assert.equal((await flushDueEmailBatches(config, mailbox(), { now: new Date('2026-09-26T02:00:00Z') })).attempted, 0);
});
