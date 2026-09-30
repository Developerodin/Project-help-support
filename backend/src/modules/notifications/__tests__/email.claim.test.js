import test from 'node:test';
import assert from 'node:assert/strict';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import Ticket from '../../tickets/ticket.model.js';
import EmailLog from '../emailLog.model.js';
import TransactionalEmailLog from '../transactionalEmailLog.model.js';
import {
  retryPendingEmails, retryPendingTransactionalEmails, sendTicketEmail, sendTransactionalEmail,
} from '../email.service.js';

withMemoryDb();

const config = {
  frontendBaseUrl: 'http://localhost:3000',
  features: { email: true },
  email: { from: 'PMS <pms@example.com>' },
};
const HOUR_AGO = () => new Date(Date.now() - 3600000);

/** Slow enough that two sweeps are both in flight at once. */
const slowTransport = () => ({
  sent: [],
  async sendMail(message) {
    await new Promise((resolve) => { setTimeout(resolve, 30); });
    this.sent.push(message);
    return {};
  },
});

async function pendingTicketRow() {
  const reporter = await User.create({
    name: 'Ada', email: `${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-long-enough-password', status: 'active',
  });
  const project = await Project.create({ key: 'WEB', name: 'Web App', createdBy: reporter._id });
  const ticket = await Ticket.create({
    ticketId: 'WEB-1', project: project._id, title: 'Retry me', createdBy: reporter._id,
  });
  await sendTicketEmail(
    'TICKET_STAGE_CHANGED', ticket, [{ user: reporter, channels: { inApp: true, email: true } }],
    { to: 'live' }, config, { transport: { sendMail: async () => { throw new Error('smtp down'); } } },
  );
  const row = await EmailLog.findOneAndUpdate({}, { $set: { lastAttemptAt: HOUR_AGO() } }, { new: true });
  return { row, reporter };
}

test('two overlapping ticket sweeps send a row exactly once', async () => {
  const { row } = await pendingTicketRow();
  const transport = slowTransport();

  const results = await Promise.all([
    retryPendingEmails(config, { transport }, { graceMs: 1000 }),
    retryPendingEmails(config, { transport }, { graceMs: 1000 }),
  ]);

  assert.equal(transport.sent.length, 1);
  assert.equal(results[0].attempted + results[1].attempted, 1);
  const after = await EmailLog.findById(row._id);
  assert.equal(after.status, 'sent');
  assert.equal(after.attemptCount, 2, 'first send plus one claimed retry');
});

test('two overlapping transactional sweeps send a row exactly once', async () => {
  await sendTransactionalEmail(
    'invite', { to: 'ops@example.com', subject: 'Invite', text: 'hi', html: '<p>hi</p>' }, config,
    { transport: { sendMail: async () => { throw new Error('smtp down'); } } },
  );
  await TransactionalEmailLog.updateMany({}, { $set: { lastAttemptAt: HOUR_AGO() } });
  const transport = slowTransport();

  await Promise.all([
    retryPendingTransactionalEmails(config, { transport }, { graceMs: 1000 }),
    retryPendingTransactionalEmails(config, { transport }, { graceMs: 1000 }),
  ]);

  assert.equal(transport.sent.length, 1);
  assert.equal((await TransactionalEmailLog.findOne({})).status, 'sent');
});

test('a live claim is left alone, and a stale one is picked up again', async () => {
  const { row } = await pendingTicketRow();
  const transport = slowTransport();

  await EmailLog.updateOne({ _id: row._id }, { $set: { status: 'sending', lastAttemptAt: new Date() } });
  assert.equal((await retryPendingEmails(config, { transport }, { graceMs: 60000 })).attempted, 0);

  await EmailLog.updateOne({ _id: row._id }, { $set: { lastAttemptAt: HOUR_AGO() } });
  assert.equal((await retryPendingEmails(config, { transport }, { graceMs: 60000 })).sent, 1);
  assert.equal(transport.sent.length, 1);
});

test('a retry for a recipient who has since been deactivated is dropped for good', async () => {
  const { row, reporter } = await pendingTicketRow();
  await User.updateOne({ _id: reporter._id }, { $set: { status: 'inactive' } });
  const transport = slowTransport();

  await retryPendingEmails(config, { transport }, { graceMs: 1000 });

  assert.equal(transport.sent.length, 0);
  const after = await EmailLog.findById(row._id);
  assert.equal(after.status, 'failed');
  assert.equal(after.attemptCount, 3, 'lifted to the cap so it is never retried');
  assert.match(after.error, /no longer active/);
});
