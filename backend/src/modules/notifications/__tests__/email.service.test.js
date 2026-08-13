import test from 'node:test';
import assert from 'node:assert/strict';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import Ticket from '../../tickets/ticket.model.js';
import EmailLog from '../emailLog.model.js';
import {
  sendTicketEmail, retryPendingEmails, messageIdFor, EMAIL_MAX_ATTEMPTS,
} from '../email.service.js';

withMemoryDb();

const config = {
  frontendBaseUrl: 'http://localhost:3000',
  features: { email: true },
  email: { from: 'PMS <pms@example.com>', host: 'smtp.example.com', port: 587 },
};

const user = () => User.create({
  name: 'Ada', email: `${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password', status: 'active',
});

async function ticketFixture() {
  const reporter = await user();
  const project = await Project.create({ key: 'WEB', name: 'Web App', createdBy: reporter._id });
  const ticket = await Ticket.create({
    ticketId: 'WEB-1', project: project._id, title: 'Broken login', createdBy: reporter._id,
  });
  return { reporter, ticket };
}

const recipientsOf = (...users) => users.map((u) => ({
  user: u, channels: { inApp: true, email: true },
}));

function fakeTransport({ failOn = () => false } = {}) {
  const sent = [];
  return {
    sent,
    sendMail: async (message) => {
      if (failOn(message)) throw new Error('421 Service not available');
      sent.push(message);
      return { messageId: message.messageId };
    },
  };
}

test('one EmailLog row per recipient, sharing one eventId', async () => {
  const { reporter, ticket } = await ticketFixture();
  const other = await user();
  const transport = fakeTransport();

  const result = await sendTicketEmail(
    'TICKET_STAGE_CHANGED', ticket, recipientsOf(reporter, other), { to: 'live' },
    config, { transport },
  );

  const rows = await EmailLog.find({});
  assert.equal(rows.length, 2);
  assert.equal(new Set(rows.map((r) => r.eventId)).size, 1);
  assert.equal(result.sent, 2);
  assert.deepEqual(rows.map((r) => r.status).sort(), ['sent', 'sent']);
});

test('a recipient who opted out of email gets no row and no message', async () => {
  const { reporter, ticket } = await ticketFixture();
  const transport = fakeTransport();

  await sendTicketEmail(
    'TICKET_COMMENTED', ticket,
    [{ user: reporter, channels: { inApp: true, email: false } }],
    {}, config, { transport },
  );

  assert.equal(await EmailLog.countDocuments({}), 0);
  assert.equal(transport.sent.length, 0);
});

test('the row is written pending BEFORE the send, so a crash leaves it visible', async () => {
  const { reporter, ticket } = await ticketFixture();
  const seenDuringSend = [];
  const transport = {
    sendMail: async () => {
      seenDuringSend.push(...(await EmailLog.find({}).lean()).map((r) => r.status));
      return { messageId: 'x' };
    },
  };

  await sendTicketEmail(
    'TICKET_STAGE_CHANGED', ticket, recipientsOf(reporter), { to: 'live' },
    config, { transport },
  );

  assert.deepEqual(seenDuringSend, ['pending']);
});

test('a failed send leaves status failed with the error recorded', async () => {
  const { reporter, ticket } = await ticketFixture();
  const transport = fakeTransport({ failOn: () => true });

  const result = await sendTicketEmail(
    'TICKET_STAGE_CHANGED', ticket, recipientsOf(reporter), { to: 'live' },
    config, { transport },
  );

  const [row] = await EmailLog.find({});
  assert.equal(result.failed, 1);
  assert.equal(row.status, 'failed');
  assert.equal(row.attemptCount, 1);
  assert.match(row.error, /421/);
});

test('Message-ID is deterministic per (eventId, recipient)', () => {
  const eventId = 'ffffffffffffffffffffffff';
  const recipient = 'aaaaaaaaaaaaaaaaaaaaaaaa';

  assert.equal(
    messageIdFor(eventId, recipient, 'example.com'),
    `<${eventId}.${recipient}@example.com>`,
  );
  assert.equal(
    messageIdFor(eventId, recipient, 'example.com'),
    messageIdFor(eventId, recipient, 'example.com'),
  );
});

test('a retry reuses the same Message-ID rather than minting a new one', async () => {
  const { reporter, ticket } = await ticketFixture();
  const failing = fakeTransport({ failOn: () => true });

  await sendTicketEmail(
    'TICKET_STAGE_CHANGED', ticket, recipientsOf(reporter), { to: 'live' },
    config, { transport: failing },
  );
  const [row] = await EmailLog.find({});
  await EmailLog.updateOne({ _id: row._id }, {
    $set: { status: 'pending', lastAttemptAt: new Date(Date.now() - 3600000) },
  });

  const working = fakeTransport();
  await retryPendingEmails(config, { transport: working }, { graceMs: 1000 });

  assert.equal(working.sent[0].messageId, row.messageId);
  assert.equal((await EmailLog.findById(row._id)).status, 'sent');
});

test('a pending row younger than the grace period is left alone', async () => {
  const { reporter, ticket } = await ticketFixture();
  await sendTicketEmail(
    'TICKET_STAGE_CHANGED', ticket, recipientsOf(reporter), { to: 'live' },
    config, { transport: fakeTransport() },
  );
  await EmailLog.updateMany({}, { $set: { status: 'pending', lastAttemptAt: new Date() } });

  const transport = fakeTransport();
  const swept = await retryPendingEmails(config, { transport }, { graceMs: 60000 });

  assert.equal(swept.attempted, 0);
  assert.equal(transport.sent.length, 0);
});

test('attemptCount caps at 3 and the row stops retrying', async () => {
  const { reporter, ticket } = await ticketFixture();
  const failing = fakeTransport({ failOn: () => true });

  await sendTicketEmail(
    'TICKET_STAGE_CHANGED', ticket, recipientsOf(reporter), { to: 'live' },
    config, { transport: failing },
  );

  for (let i = 0; i < 5; i += 1) {
    await EmailLog.updateMany({}, {
      $set: { status: 'pending', lastAttemptAt: new Date(Date.now() - 3600000) },
    });
    await retryPendingEmails(config, { transport: failing }, { graceMs: 1000 });
  }

  const [row] = await EmailLog.find({});
  assert.equal(row.attemptCount, EMAIL_MAX_ATTEMPTS);
  assert.equal(row.status, 'failed');
});

test('with no email group configured, nothing is attempted and nothing throws', async () => {
  const { reporter, ticket } = await ticketFixture();
  const transport = fakeTransport();

  const result = await sendTicketEmail(
    'TICKET_STAGE_CHANGED', ticket, recipientsOf(reporter), { to: 'live' },
    { ...config, features: { email: false }, email: null }, { transport },
  );

  assert.equal(result.skipped, true);
  assert.equal(await EmailLog.countDocuments({}), 0);
  assert.equal(transport.sent.length, 0);
});
