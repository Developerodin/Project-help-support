import test from 'node:test';
import assert from 'node:assert/strict';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import Ticket from '../../tickets/ticket.model.js';
import Notification from '../notification.model.js';
import EmailLog from '../emailLog.model.js';
import { dispatchTicketEvent } from '../dispatch.js';

withMemoryDb();

const config = {
  frontendBaseUrl: 'http://localhost:3000',
  features: { email: true },
  email: { from: 'PMS <pms@example.com>' },
};

const user = (role = 'member') => User.create({
  name: role, email: `${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password', status: 'active', role,
});

async function fixture() {
  const reporter = await user();
  const actor = await user('admin');
  const project = await Project.create({ key: 'WEB', name: 'Web App', createdBy: actor._id });
  const ticket = await Ticket.create({
    ticketId: 'WEB-1', project: project._id, title: 'Broken login', createdBy: reporter._id,
  });
  return { reporter, actor, ticket };
}

const transport = () => ({ sendMail: async (m) => ({ messageId: m.messageId }) });

test('one dispatch produces one in-app row and one email row per recipient', async () => {
  const { actor, ticket } = await fixture();

  await dispatchTicketEvent({
    event: { type: 'TICKET_STAGE_CHANGED', from: 'pending', to: 'live' },
    ticket, actor, config, deps: { transport: transport() },
  });

  assert.equal(await Notification.countDocuments({}), 1);
  assert.equal(await EmailLog.countDocuments({}), 1);
});

test('a mail failure is logged and swallowed — the caller never sees it', async () => {
  const { actor, ticket } = await fixture();
  const exploding = { sendMail: async () => { throw new Error('smtp down'); } };

  await dispatchTicketEvent({
    event: { type: 'TICKET_STAGE_CHANGED', from: 'pending', to: 'live' },
    ticket, actor, config, deps: { transport: exploding },
  });

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
  const { reporter, actor, ticket } = await fixture();
  const mentioned = await user();

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
