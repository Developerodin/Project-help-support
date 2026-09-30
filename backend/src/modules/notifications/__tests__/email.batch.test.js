import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS } from '@pms/shared';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import Ticket from '../../tickets/ticket.model.js';
import EmailLog from '../emailLog.model.js';
import Notification from '../notification.model.js';
import {
  enqueueTicketEmail, flushDueEmailBatches, retryPendingEmails, sendUrgentTicketEmail,
} from '../email.service.js';

withMemoryDb();

const MIN = 60 * 1000;
const config = {
  frontendBaseUrl: 'http://localhost:3000',
  features: { email: true },
  email: { from: 'PMS <pms@example.com>', batchWindowMs: 5 * MIN, batchMaxMs: 15 * MIN },
};
const LATER = () => new Date(Date.now() + 60 * MIN);

function mailbox() {
  const sent = [];
  return { sent, transport: { sendMail: async (m) => { sent.push(m); return {}; } } };
}

async function fixture() {
  const reader = await User.create({
    name: 'Ada', email: `${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-long-enough-password', status: 'active', role: ROLE_IDS.ADMIN,
    notificationPrefs: { email: { TICKET_COMMENTED: true } },
  });
  const project = await Project.create({ key: 'WEB', name: 'Web App', createdBy: reader._id });
  const ticket = await Ticket.create({
    ticketId: 'WEB-1', project: project._id, title: 'Broken login', createdBy: reader._id, status: 'deployed_staging',
  });
  return { reader, ticket };
}

const item = (event, context = {}, extra = {}) => ({
  event, context: { actorName: 'Ravi', ...context }, ...extra,
});

const stage = (from, to) => item('TICKET_STAGE_CHANGED', { from, to });

test('each event slides the send back one window, but never past the max', async () => {
  const { reader, ticket } = await fixture();
  const t0 = new Date('2026-09-01T10:00:00Z');
  const at = (minutes) => new Date(t0.getTime() + minutes * MIN);

  let row = await enqueueTicketEmail(reader._id, ticket, stage('pending', 'in_progress'), config, { now: t0 });
  assert.deepEqual([row.sendAfter, row.batchDeadline], [at(5), at(15)]);

  row = await enqueueTicketEmail(reader._id, ticket, stage('in_progress', 'ready_qa'), config, { now: at(4) });
  assert.deepEqual(row.sendAfter, at(9));

  await enqueueTicketEmail(reader._id, ticket, stage('ready_qa', 'deployed_staging'), config, { now: at(12) });
  row = await EmailLog.findOne({ status: 'queued' });
  assert.deepEqual(row.sendAfter, at(15), 'capped at the deadline, not 17 minutes');
  assert.equal(row.batch.length, 3);

  assert.equal((await flushDueEmailBatches(config, mailbox(), { now: at(14) })).attempted, 0);
});

test('two events enqueued at once land in one queued row', async () => {
  const { reader, ticket } = await fixture();
  await EmailLog.init();

  await Promise.all([
    enqueueTicketEmail(reader._id, ticket, item('TICKET_CREATED'), config),
    enqueueTicketEmail(reader._id, ticket, item('TICKET_CLOSED'), config),
  ]);

  const rows = await EmailLog.find({});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'queued');
  assert.deepEqual(rows[0].batch.map((i) => i.event).sort(), ['TICKET_CLOSED', 'TICKET_CREATED']);
});

test('an urgent event takes the queued batch with it, as one email', async () => {
  const { reader, ticket } = await fixture();
  const { sent, transport } = mailbox();
  await enqueueTicketEmail(reader._id, ticket, stage('ready_qa', 'deployed_staging'), config);

  await sendUrgentTicketEmail(
    'TICKET_MENTIONED', ticket, [{ user: reader, channels: { email: true } }],
    { actorName: 'Mira', commentAuthor: 'Mira', comment: 'Can you check staging?' }, config, { transport },
  );

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /^2 updates on WEB-1/);
  // The mention leads, even though it happened last.
  assert.ok(sent[0].text.indexOf('Mira mentioned you') < sent[0].text.indexOf('Ravi moved this ticket'));
  assert.equal(await EmailLog.countDocuments({ status: 'queued' }), 0);
  assert.equal((await EmailLog.findOne({})).status, 'sent');
});

test('an urgent event with no batch waiting is sent alone, straight away', async () => {
  const { reader, ticket } = await fixture();
  const { sent, transport } = mailbox();

  await sendUrgentTicketEmail(
    'TICKET_ASSIGNED', ticket, [{ user: reader, channels: { email: true } }],
    { actorName: 'Mira' }, config, { transport },
  );

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /^Mira assigned this ticket to you\./);
});

test('a stage move there and back again sends nothing', async () => {
  const { reader, ticket } = await fixture();
  const { sent, transport } = mailbox();
  await enqueueTicketEmail(reader._id, ticket, stage('ready_qa', 'deployed_staging'), config);
  await enqueueTicketEmail(reader._id, ticket, stage('deployed_staging', 'ready_qa'), config);

  const result = await flushDueEmailBatches(config, { transport }, { now: LATER() });

  assert.equal(result.skipped, 1);
  assert.equal(sent.length, 0);
  const row = await EmailLog.findOne({});
  assert.equal(row.status, 'skipped');
  assert.ok(row.skippedAt);
});

test('several stage moves collapse to the net move, rendered as a single email', async () => {
  const { reader, ticket } = await fixture();
  const { sent, transport } = mailbox();
  await enqueueTicketEmail(reader._id, ticket, stage('ready_qa', 'deployed_staging'), config);
  await enqueueTicketEmail(reader._id, ticket, stage('deployed_staging', 'qa_approved'), config);

  await flushDueEmailBatches(config, { transport }, { now: LATER() });

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /^Ravi moved this ticket to Staging QA Approved\./);
  assert.match(sent[0].text, /Moved: Ready for QA -> Staging QA Approved/);
});

test('a digest shows the stage path and every remaining update', async () => {
  const { reader, ticket } = await fixture();
  const { sent, transport } = mailbox();
  await enqueueTicketEmail(reader._id, ticket, stage('ready_qa', 'deployed_staging'), config);
  await enqueueTicketEmail(reader._id, ticket, item('TICKET_COMMENTED', {
    commentAuthor: 'Nina', comment: 'Looks good on staging.',
  }), config);
  await enqueueTicketEmail(reader._id, ticket, stage('deployed_staging', 'qa_approved'), config);

  await flushDueEmailBatches(config, { transport }, { now: LATER() });

  assert.equal(sent.length, 1);
  const { text, html } = sent[0];
  assert.match(text, /^2 updates on WEB-1/);
  assert.match(text, /Stage: Ready for QA -> Deployed to Staging -> Staging QA Approved/);
  assert.match(text, /- Nina commented on this ticket\. "Looks good on staging\."/);
  assert.match(html, /2 updates on WEB-1/);
  assert.equal((await EmailLog.findOne({})).template, 'ticket_digest');
});

test('an update already read in-app is left out of the email', async () => {
  const { reader, ticket } = await fixture();
  const { sent, transport } = mailbox();
  const [read, unread] = await Notification.create([
    { user: reader._id, event: 'TICKET_CREATED', ticket: ticket._id, title: 'a', readAt: new Date() },
    { user: reader._id, event: 'TICKET_CLOSED', ticket: ticket._id, title: 'b' },
  ]);
  await enqueueTicketEmail(reader._id, ticket, item('TICKET_CREATED', {}, { notificationId: read._id }), config);
  await enqueueTicketEmail(reader._id, ticket, item('TICKET_CLOSED', {}, { notificationId: unread._id }), config);

  await flushDueEmailBatches(config, { transport }, { now: LATER() });

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /^Ravi closed this ticket\./);
});

test('a batch whose every update was read in-app is skipped', async () => {
  const { reader, ticket } = await fixture();
  const { sent, transport } = mailbox();
  const read = await Notification.create({
    user: reader._id, event: 'TICKET_CREATED', ticket: ticket._id, title: 'a', readAt: new Date(),
  });
  await enqueueTicketEmail(reader._id, ticket, item('TICKET_CREATED', {}, { notificationId: read._id }), config);

  await flushDueEmailBatches(config, { transport }, { now: LATER() });

  assert.equal(sent.length, 0);
  assert.equal((await EmailLog.findOne({})).status, 'skipped');
  // Terminal: the retry sweep never picks a skipped row up.
  assert.equal((await retryPendingEmails(config, { transport }, { graceMs: 0 })).attempted, 0);
});

test('every ticket email shares one subject and replies to the ticket thread', async () => {
  const { reader, ticket } = await fixture();
  const { sent, transport } = mailbox();
  const thread = `<ticket.${ticket._id}@example.com>`;

  await enqueueTicketEmail(reader._id, ticket, stage('ready_qa', 'deployed_staging'), config);
  await flushDueEmailBatches(config, { transport }, { now: LATER() });
  await sendUrgentTicketEmail(
    'TICKET_MENTIONED', ticket, [{ user: reader, channels: { email: true } }], { actorName: 'Mira' }, config, { transport },
  );

  assert.equal(sent.length, 2);
  for (const message of sent) {
    assert.equal(message.subject, '[WEB-1] Broken login');
    assert.equal(message.inReplyTo, thread);
    assert.equal(message.references, thread);
  }
  assert.notEqual(sent[0].messageId, sent[1].messageId);
});

test('a failed batch send is resent by the retry sweep with the same headers', async () => {
  const { reader, ticket } = await fixture();
  await enqueueTicketEmail(reader._id, ticket, item('TICKET_CLOSED'), config);
  await flushDueEmailBatches(config, { transport: { sendMail: async () => { throw new Error('smtp down'); } } }, {
    now: LATER(),
  });
  const failed = await EmailLog.findOneAndUpdate({}, { $set: { lastAttemptAt: new Date(Date.now() - 60 * MIN) } }, { new: true });
  assert.equal(failed.status, 'failed');

  const { sent, transport } = mailbox();
  await retryPendingEmails(config, { transport }, { graceMs: 1000 });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].messageId, failed.messageId);
  assert.equal(sent[0].inReplyTo, `<ticket.${ticket._id}@example.com>`);
  assert.match(sent[0].text, /^Ravi closed this ticket\./);
});

test('a batch claimed by a process that died before rendering is flushed again, not retried', async () => {
  const { reader, ticket } = await fixture();
  await enqueueTicketEmail(reader._id, ticket, item('TICKET_CLOSED'), config);
  await EmailLog.updateOne({}, {
    $set: { status: 'sending', lastAttemptAt: new Date(Date.now() - 60 * MIN) }, $inc: { attemptCount: 1 },
  });
  const { sent, transport } = mailbox();

  assert.equal((await retryPendingEmails(config, { transport }, { graceMs: 1000 })).attempted, 0);
  assert.equal((await flushDueEmailBatches(config, { transport }, { graceMs: 1000 })).sent, 1);
  assert.equal(sent.length, 1);
  assert.equal((await EmailLog.findOne({})).attemptCount, 2);
});

test('a recipient who switched the event off by send time gets nothing', async () => {
  const { reader, ticket } = await fixture();
  await enqueueTicketEmail(reader._id, ticket, item('TICKET_CLOSED'), config);
  await User.updateOne({ _id: reader._id }, { $set: { 'notificationPrefs.email.TICKET_CLOSED': false } });
  const { sent, transport } = mailbox();

  await flushDueEmailBatches(config, { transport }, { now: LATER() });

  assert.equal(sent.length, 0);
  assert.equal((await EmailLog.findOne({})).status, 'skipped');
});
