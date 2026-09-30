import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS } from '@pms/shared';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import Client from '../../clients/client.model.js';
import Ticket from '../../tickets/ticket.model.js';
import EmailLog from '../emailLog.model.js';
import TransactionalEmailLog from '../transactionalEmailLog.model.js';
import {
  sendTicketEmail,
  retryPendingEmails,
  messageIdFor,
  EMAIL_MAX_ATTEMPTS,
  sendTransactionalEmail,
  retryPendingTransactionalEmails,
  TransactionalEmailDeliveryError,
} from '../email.service.js';

withMemoryDb();

const config = {
  frontendBaseUrl: 'http://localhost:3000',
  features: { email: true },
  email: {
    from: 'PMS <pms@example.com>',
    host: 'smtp.example.com',
    port: 587,
    testSinkEnabled: false,
    testSinkTo: '',
  },
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

async function brandedTicketFixture() {
  const actor = await user();
  const key = `B${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  const client = await Client.create({
    name: `Brand ${Date.now()}`,
    createdBy: actor._id,
  });
  const project = await Project.create({
    key,
    name: 'Brand Portal',
    brand: client.name,
    client: client._id,
    createdBy: actor._id,
  });
  const ticket = await Ticket.create({
    ticketId: `${key}-1`,
    project: project._id,
    title: 'Branded mail policy',
    createdBy: actor._id,
  });
  const populated = await Ticket.findById(ticket._id).populate({
    path: 'project',
    select: 'brand client',
    populate: { path: 'client', select: 'name logoKey' },
  });
  return { actor, ticket: populated, client };
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

test('a configured test sink gets one separate copy per notification fan-out', async () => {
  const { reporter, ticket } = await ticketFixture();
  const other = await user();
  const transport = fakeTransport();

  await sendTicketEmail(
    'TICKET_STAGE_CHANGED',
    ticket,
    recipientsOf(reporter, other),
    { to: 'live' },
    {
      ...config,
      email: {
        ...config.email,
        testSinkEnabled: true,
        testSinkTo: 'sink@example.com',
      },
    },
    { transport },
  );

  assert.equal(transport.sent.length, 3);
  assert.equal(transport.sent[0].bcc, undefined);
  assert.equal(transport.sent[1].bcc, undefined);
  const sinkCopies = transport.sent.filter((m) => m.to === 'sink@example.com');
  assert.equal(sinkCopies.length, 1);
  assert.match(sinkCopies[0].subject, /^\[notification-test-sink\] /);
});

test('test sink is ignored when not explicitly enabled', async () => {
  const { reporter, ticket } = await ticketFixture();
  const transport = fakeTransport();

  await sendTicketEmail(
    'TICKET_STAGE_CHANGED',
    ticket,
    recipientsOf(reporter),
    { to: 'live' },
    {
      ...config,
      email: {
        ...config.email,
        testSinkEnabled: false,
        testSinkTo: 'sink@example.com',
      },
    },
    { transport },
  );

  assert.equal(transport.sent[0].bcc, undefined);
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

test('retry prefers immutable render snapshot context when available', async () => {
  const { reporter, ticket } = await ticketFixture();
  await sendTicketEmail(
    'TICKET_STAGE_CHANGED',
    ticket,
    recipientsOf(reporter),
    { from: 'pending', to: 'live', note: 'Ready for release', reason: 'QA signed off' },
    config,
    { transport: fakeTransport() },
  );

  const [row] = await EmailLog.find({});
  await Ticket.updateOne({ _id: ticket._id }, { $set: { title: 'Changed after first delivery' } });
  await EmailLog.updateOne(
    { _id: row._id },
    { $set: { status: 'pending', lastAttemptAt: new Date(Date.now() - 3600000) } },
  );

  const retryTransport = fakeTransport();
  await retryPendingEmails(config, { transport: retryTransport }, { graceMs: 1000 });

  assert.match(retryTransport.sent[0].text, /Ready for release/);
  assert.match(retryTransport.sent[0].text, /QA signed off/);
  assert.doesNotMatch(retryTransport.sent[0].text, /Changed after first delivery/);
});

test('retry falls back safely for legacy rows without render snapshot', async () => {
  const { reporter, ticket } = await ticketFixture();
  await sendTicketEmail(
    'TICKET_STAGE_CHANGED',
    ticket,
    recipientsOf(reporter),
    { to: 'live' },
    config,
    { transport: fakeTransport() },
  );

  const [row] = await EmailLog.find({});
  await Ticket.updateOne({ _id: ticket._id }, { $set: { title: 'Latest ticket title' } });
  await EmailLog.updateOne(
    { _id: row._id },
    {
      $set: {
        status: 'pending',
        lastAttemptAt: new Date(Date.now() - 3600000),
      },
      $unset: { renderSnapshot: 1 },
    },
  );

  const retryTransport = fakeTransport();
  await retryPendingEmails(config, { transport: retryTransport }, { graceMs: 1000 });

  assert.match(retryTransport.sent[0].text, /Latest ticket title/);
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

test('external branded email without logo is blocked and stays replayable', async () => {
  const { ticket, client } = await brandedTicketFixture();
  const external = await User.create({
    name: 'External Client',
    email: `${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-long-enough-password',
    status: 'active',
    role: ROLE_IDS.CLIENT,
  });
  const transport = fakeTransport();

  const result = await sendTicketEmail(
    'TICKET_STAGE_CHANGED',
    ticket,
    recipientsOf(external),
    { to: 'live' },
    attachmentConfig,
    { transport },
  );

  assert.equal(result.sent, 0);
  assert.equal(result.failed, 1);
  assert.equal(transport.sent.length, 0);

  const [row] = await EmailLog.find({});
  assert.equal(row.status, 'failed');
  assert.equal(row.attemptCount, 1);
  assert.match(row.error, /Brand logo/i);
  assert.equal(row.renderSnapshot?.requireBrandLogo, true);

  await EmailLog.updateOne(
    { _id: row._id },
    { $set: { lastAttemptAt: new Date(Date.now() - 3600000) } },
  );
  await Client.updateOne(
    { _id: client._id },
    { $set: { logoKey: 'companies/fixed-logo.png' } },
  );
  const replayTransport = fakeTransport();
  const replay = await retryPendingEmails(
    attachmentConfig,
    { transport: replayTransport },
    { graceMs: 1000 },
  );
  const replayed = await EmailLog.findById(row._id);
  assert.equal(replay.attempted, 1);
  assert.equal(replay.sent, 1);
  assert.equal(replay.failed, 0);
  assert.equal(replayTransport.sent.length, 1);
  assert.match(String(replayTransport.sent[0].attachments?.[0]?.path ?? ''), /fixed-logo\.png/);
  assert.equal(replayed.status, 'sent');
  assert.equal(replayed.attemptCount, 2);
});

test('internal branded email without logo still uses safe fallback attachment', async () => {
  const { ticket, actor } = await brandedTicketFixture();
  const transport = fakeTransport();

  const result = await sendTicketEmail(
    'TICKET_STAGE_CHANGED',
    ticket,
    recipientsOf(actor),
    { to: 'live' },
    attachmentConfig,
    { transport },
  );

  assert.equal(result.sent, 1);
  assert.equal(result.failed, 0);
  assert.equal(transport.sent.length, 1);
  assert.equal(transport.sent[0].attachments?.[0]?.path, undefined);
  assert.ok(Buffer.isBuffer(transport.sent[0].attachments?.[0]?.content));
});

test('transactional delivery failures are durable and replayable', async () => {
  const failing = fakeTransport({ failOn: () => true });
  const first = await sendTransactionalEmail(
    'invite',
    {
      to: 'ada@example.com',
      subject: 'Invite',
      text: 'hello',
      html: '<p>hello</p>',
    },
    config,
    { transport: failing },
    { requestId: 'req-1' },
  );

  assert.equal(first.sent, false);
  assert.equal(first.queued, true);
  const row = await TransactionalEmailLog.findById(first.logId);
  assert.equal(row.status, 'failed');
  assert.equal(row.text, 'hello', 'a retryable row keeps its body');

  await TransactionalEmailLog.updateOne(
    { _id: row._id },
    { $set: { lastAttemptAt: new Date(Date.now() - 3600000) } },
  );
  const working = fakeTransport();
  const replay = await retryPendingTransactionalEmails(
    config,
    { transport: working },
    { graceMs: 1000, maxAttempts: 3 },
  );

  assert.equal(replay.attempted, 1);
  assert.equal(replay.sent, 1);
  const sentRow = await TransactionalEmailLog.findById(row._id);
  assert.equal(sentRow.status, 'sent');
  assert.equal(working.sent[0].text, 'hello');
  assert.equal(sentRow.text, '[redacted]');
  assert.equal(sentRow.html, '[redacted]');
});

test('a transactional row out of attempts has its body redacted', async () => {
  const first = await sendTransactionalEmail(
    'password_reset',
    { to: 'ada@example.com', subject: 'Reset', text: 'reset?token=abc', html: '<a>reset?token=abc</a>' },
    config,
    { transport: fakeTransport({ failOn: () => true }) },
  );
  await TransactionalEmailLog.updateOne(
    { _id: first.logId },
    { $set: { attemptCount: 3, lastAttemptAt: new Date(Date.now() - 3600000) } },
  );

  await retryPendingTransactionalEmails(config, { transport: fakeTransport() }, { graceMs: 1000, maxAttempts: 3 });

  const row = await TransactionalEmailLog.findById(first.logId);
  assert.equal(row.status, 'failed');
  assert.doesNotMatch(row.text + row.html, /token=abc/);
});

test('transactional deliverer throws rich failure when requested', async () => {
  await assert.rejects(
    () => sendTransactionalEmail(
      'password_reset',
      {
        to: 'ada@example.com',
        subject: 'Reset',
        text: 'hello',
        html: '<p>hello</p>',
      },
      config,
      { transport: fakeTransport({ failOn: () => true }) },
      { throwOnError: true },
    ),
    (err) => err instanceof TransactionalEmailDeliveryError && typeof err.logId === 'string',
  );
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
