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
import { dispatchTicketEvent } from '../dispatch.js';
import { flushDueEmailBatches } from '../email.service.js';
import * as hub from '../../realtime/realtime-hub.js';

withMemoryDb();

const config = {
  frontendBaseUrl: 'http://localhost:3000',
  features: { email: true, attachments: true },
  email: { from: 'PMS <pms@example.com>' },
  storage: {
    region: 'us-east-1',
    accessKeyId: 'test-access-key',
    secretAccessKey: 'test-secret-key',
    bucket: 'test-branding-bucket',
  },
};

const user = (role = ROLE_IDS.DEVELOPER, name = 'Dev') => User.create({
  name, email: `${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password', status: 'active', role,
});

const mailbox = () => {
  const sent = [];
  return { sent, transport: { sendMail: async (m) => { sent.push(m); return {}; } } };
};

/** Routine events wait in a batch; send whatever is queued as if the window had passed. */
const flush = (transport) => flushDueEmailBatches(config, { transport }, {
  now: new Date(Date.now() + 60 * 60 * 1000),
});

/** An admin actor, an internal team member, and an external client who watches the ticket. */
async function fixture() {
  const admin = await user(ROLE_IDS.ADMIN, 'Asha');
  const dev = await user(ROLE_IDS.DEVELOPER, 'Ravi');
  const client = await user(ROLE_IDS.CLIENT, 'Clara');
  const company = await Client.create({
    name: `Acme ${Date.now()}`, logoKey: 'companies/acme.png', createdBy: admin._id,
  });
  const team = await Team.create({ name: 'Core', members: [dev._id], createdBy: admin._id });
  const project = await Project.create({
    key: 'WEB', name: 'Web App', client: company._id, team: team._id, createdBy: admin._id,
  });
  await AccessAssignment.create({
    user: client._id, role: ROLE_IDS.CLIENT, client: company._id, project: project._id, grantedBy: admin._id,
  });
  const ticket = await Ticket.create({
    ticketId: 'WEB-1', project: project._id, team: team._id, title: 'Broken login',
    createdBy: dev._id, watchers: [client._id],
  });
  return { admin, dev, client, team, project, ticket };
}

const rowFor = (u) => Notification.findOne({ user: u._id }).lean();

test('a close reason reaches internal rows but never an external row or its push', async () => {
  const { admin, dev, client, ticket } = await fixture();
  const pushed = [];
  const sendPush = async (rows) => { pushed.push(...rows); };

  await dispatchTicketEvent({
    event: { type: 'TICKET_CLOSED', from: 'live', to: 'closed', reason: 'Duplicate of WEB-99' },
    ticket, actor: admin, config, deps: { transport: mailbox().transport, sendPush },
  });

  const internal = await rowFor(dev);
  const external = await rowFor(client);
  assert.equal(internal.title, 'Asha closed WEB-1');
  assert.equal(internal.body, 'Broken login — Duplicate of WEB-99');
  assert.equal(external.title, 'Asha closed WEB-1');
  assert.equal(external.body, 'Broken login');
  const externalPush = pushed.find((n) => String(n.user) === String(client._id));
  assert.doesNotMatch(`${externalPush.title} ${externalPush.body}`, /Duplicate/);
});

test('a stage move a client cannot see reaches internal people only, on every channel', async () => {
  const { admin, dev, client, ticket } = await fixture();
  const { sent, transport } = mailbox();

  await dispatchTicketEvent({
    event: { type: 'TICKET_STAGE_CHANGED', from: 'in_progress', to: 'ready_qa' },
    ticket, actor: admin, config, deps: { transport },
  });

  assert.equal((await rowFor(dev)).title, 'Asha moved WEB-1 to Ready for QA');
  assert.equal(await rowFor(client), null);
  assert.equal(await EmailLog.countDocuments({ recipientUserId: client._id }), 0);
  assert.ok(!sent.some((m) => m.to[0] === client.email));
});

test('an external recipient reads client-facing statuses in-app and in email', async () => {
  const { admin, dev, client, ticket } = await fixture();
  const { sent, transport } = mailbox();

  await dispatchTicketEvent({
    event: { type: 'TICKET_STAGE_CHANGED', from: 'live', to: 'in_progress' },
    ticket, actor: admin, config, deps: { transport },
  });
  await flush(transport);

  assert.equal((await rowFor(dev)).title, 'Asha moved WEB-1 to In Progress');
  assert.equal((await rowFor(client)).title, 'Asha moved WEB-1 to Under Review');
  const toClient = sent.find((m) => m.to[0] === client.email);
  assert.ok(toClient, 'the client is emailed');
  assert.doesNotMatch(`${toClient.subject}\n${toClient.text}`, /In Progress/);
  assert.match(toClient.text, /Under Review/);
});

test('someone mentioned in a comment hears about it once, as a mention', async () => {
  const { admin, dev, ticket: created } = await fixture();
  const ticket = await Ticket.findByIdAndUpdate(created._id, {
    $push: { comments: { content: 'Can you look at this?', commentedBy: admin._id, createdAt: new Date() } },
  }, { new: true });
  const commentId = String(ticket.comments[0]._id);
  const { sent, transport } = mailbox();

  await dispatchTicketEvent({
    event: { type: 'TICKET_COMMENTED', commentId, mentions: [String(dev._id)] },
    ticket, actor: admin, config, deps: { transport },
  });

  const rows = await Notification.find({ user: dev._id }).lean();
  assert.deepEqual(rows.map((r) => r.event), ['TICKET_MENTIONED']);
  assert.equal(rows[0].title, 'Asha mentioned you on WEB-1');
  assert.equal(rows[0].body, 'Broken login — Can you look at this?');
  assert.match(rows[0].link, new RegExp(`&comment=${commentId}$`));
  assert.equal(sent.filter((m) => m.to[0] === dev.email).length, 1);
});

test('a mention of someone who cannot open the ticket notifies nobody', async () => {
  const { admin, ticket } = await fixture();
  const outsider = await user(ROLE_IDS.DEVELOPER, 'Out');

  await dispatchTicketEvent({
    event: { type: 'TICKET_COMMENTED', commentId: 'x', mentions: [String(outsider._id)] },
    ticket, actor: admin, config, deps: { transport: mailbox().transport },
  });

  assert.equal(await rowFor(outsider), null);
});

test('reassignment tells the new assignee, the previous one, and everyone else in their own words', async () => {
  const { admin, dev, ticket } = await fixture();
  const newcomer = await user(ROLE_IDS.DEVELOPER, 'Nina');
  await Ticket.updateOne({ _id: ticket._id }, { $set: { assignedTo: newcomer._id } });
  const doc = await Ticket.findById(ticket._id).populate(['assignedTo', 'createdBy', 'project']);
  const previous = await user(ROLE_IDS.DEVELOPER, 'Omar');
  const { sent, transport } = mailbox();

  await dispatchTicketEvent({
    event: { type: 'TICKET_ASSIGNED', previousAssignee: String(previous._id) },
    ticket: doc, actor: admin, config, deps: { transport },
  });

  assert.equal((await rowFor(newcomer)).title, 'Asha assigned WEB-1 to you');
  assert.equal((await rowFor(previous)).title, 'Asha unassigned you from WEB-1');
  assert.equal((await rowFor(dev)).title, 'Asha assigned WEB-1 to Nina');
  // The new assignee hears at once; the previous one's email waits in the batch.
  assert.match(sent.find((m) => m.to[0] === newcomer.email).text, /^Asha assigned this ticket to you\./);
  assert.equal(sent.find((m) => m.to[0] === previous.email), undefined);
  await flush(transport);
  assert.match(sent.find((m) => m.to[0] === previous.email).text, /^Asha unassigned you from this ticket\./);
  assert.match(sent.find((m) => m.to[0] === dev.email).text, /^Asha changed who this ticket is assigned to\./);
});

test('recipients get a content-free notification.created nudge', async () => {
  const { admin, dev, ticket } = await fixture();
  const frames = [];
  const client = { userId: String(dev._id), res: { write: (f) => frames.push(f) } };
  hub.subscribe(client);
  try {
    await dispatchTicketEvent({
      event: { type: 'TICKET_ESTIMATE_SET' },
      ticket, actor: admin, config, deps: { transport: mailbox().transport },
    });
  } finally {
    hub.unsubscribe(client);
  }

  assert.deepEqual(frames, [`data: ${JSON.stringify({ type: 'notification.created' })}\n\n`]);
});

test('titles fall back to Someone and stored rows carry the project', async () => {
  const { dev, project, ticket } = await fixture();

  await dispatchTicketEvent({
    event: { type: 'TICKET_CREATED' },
    ticket, actor: null, config, deps: { transport: mailbox().transport },
  });

  const row = await rowFor(dev);
  assert.equal(row.title, 'Someone filed WEB-1');
  assert.equal(String(row.project), String(project._id));
});
