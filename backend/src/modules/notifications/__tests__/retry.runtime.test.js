import test from 'node:test';
import assert from 'node:assert/strict';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import Ticket from '../../tickets/ticket.model.js';
import EmailLog from '../emailLog.model.js';
import TransactionalEmailLog from '../transactionalEmailLog.model.js';
import { sendTicketEmail, sendTransactionalEmail } from '../email.service.js';
import {
  replayNotificationOutboxOnBoot,
  scheduleNotificationOutboxReplay,
} from '../retry.runtime.js';

withMemoryDb();

const config = {
  frontendBaseUrl: 'http://localhost:3000',
  features: { email: true },
  email: {
    from: 'PMS <pms@example.com>',
    host: 'smtp.example.com',
    port: 587,
    retryIntervalMs: 2500,
    retryGraceMs: 1000,
    retryMaxAttempts: 3,
    retryBatchLimit: 50,
  },
};

const fakeTransport = () => ({
  sent: [],
  sendMail: async function sendMail(message) {
    this.sent.push(message);
    return { messageId: message.messageId || 'tx' };
  },
});

async function createPendingTicketEmailRow() {
  const reporter = await User.create({
    name: 'Ada',
    email: `${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-long-enough-password',
    status: 'active',
  });
  const project = await Project.create({ key: 'WEB', name: 'Web App', createdBy: reporter._id });
  const ticket = await Ticket.create({
    ticketId: 'WEB-1',
    project: project._id,
    title: 'Retry this notification',
    createdBy: reporter._id,
  });

  await sendTicketEmail(
    'TICKET_STAGE_CHANGED',
    ticket,
    [{ user: reporter, channels: { inApp: true, email: true } }],
    { to: 'live' },
    config,
    { transport: fakeTransport() },
  );

  const [row] = await EmailLog.find({});
  await EmailLog.updateOne(
    { _id: row._id },
    { $set: { status: 'pending', lastAttemptAt: new Date(Date.now() - 3600000) } },
  );
}

async function createPendingTransactionalRow() {
  await sendTransactionalEmail(
    'invite',
    {
      to: 'ops@example.com',
      subject: 'Invite',
      text: 'hello',
      html: '<p>hello</p>',
    },
    config,
    {
      transport: {
        sendMail: async () => {
          throw new Error('smtp down');
        },
      },
    },
  );

  const [row] = await TransactionalEmailLog.find({});
  await TransactionalEmailLog.updateOne(
    { _id: row._id },
    { $set: { lastAttemptAt: new Date(Date.now() - 3600000) } },
  );
}

test('boot replay processes pending ticket and transactional email rows', async () => {
  await createPendingTicketEmailRow();
  await createPendingTransactionalRow();

  const transport = fakeTransport();
  await replayNotificationOutboxOnBoot(config, { transport });

  assert.equal(await EmailLog.countDocuments({ status: 'sent' }), 1);
  assert.equal(await TransactionalEmailLog.countDocuments({ status: 'sent' }), 1);
  assert.equal(transport.sent.length >= 2, true);
});

test('interval replay uses configured cadence and stops safely', async () => {
  await createPendingTicketEmailRow();

  let scheduled = null;
  const cleared = [];
  const setIntervalFn = (fn, ms) => {
    scheduled = { fn, ms };
    return { unref() {} };
  };
  const clearIntervalFn = (handle) => {
    cleared.push(handle);
  };

  const transport = fakeTransport();
  const stop = scheduleNotificationOutboxReplay(config, {
    transport,
    setIntervalFn,
    clearIntervalFn,
  });

  assert.equal(scheduled.ms, config.email.retryIntervalMs);
  await scheduled.fn();
  assert.equal(await EmailLog.countDocuments({ status: 'sent' }), 1);

  stop();
  assert.equal(cleared.length, 1);
});
