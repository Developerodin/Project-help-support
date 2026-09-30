import test from 'node:test';
import assert from 'node:assert/strict';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import Ticket from '../../tickets/ticket.model.js';
import Notification from '../notification.model.js';
import { dispatchTicketEvent } from '../dispatch.js';
import { resolveTicketDocForNotifications } from '../../tickets/ticket.service.js';

withMemoryDb();

const testConfig = {
  frontendBaseUrl: 'http://localhost:3000',
  features: { email: false },
};

function user(name) {
  return User.create({
    name,
    email: `${name}-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-long-enough-password',
    status: 'active',
    role: 'developer',
  });
}

test('stage change dispatches TICKET_STAGE_CHANGED in-app notification with context body', async () => {
  const actor = await user('Mover');
  const watcher = await user('Watcher');
  const project = await Project.create({ key: 'WEB', name: 'Web', createdBy: actor._id });

  const ticket = await Ticket.create({
    ticketId: 'WEB-68',
    project: project._id,
    title: 'Stage bug',
    description: 'Repro steps long enough here',
    createdBy: actor._id,
    watchers: [watcher._id],
    severity: 'Minor',
    priority: 'Low',
    status: 'pending',
  });

  const doc = await resolveTicketDocForNotifications(ticket.ticketId);

  await dispatchTicketEvent({
    event: {
      type: 'TICKET_STAGE_CHANGED',
      from: 'pending',
      to: 'in_progress',
      requestId: 'test-req',
    },
    ticket: doc,
    actor,
    config: testConfig,
  });

  const rows = await Notification.find({ user: watcher._id }).lean();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].event, 'TICKET_STAGE_CHANGED');
  assert.equal(rows[0].title, 'Mover moved WEB-68 to In Progress');
  assert.equal(rows[0].body, 'Stage bug');
});

test('comment dispatch stores comment excerpt in notification body', async () => {
  const actor = await user('Commenter');
  const watcher = await user('Reader');
  const project = await Project.create({ key: 'WEB', name: 'Web', createdBy: actor._id });

  const ticket = await Ticket.create({
    ticketId: 'WEB-99',
    project: project._id,
    title: 'Comment ticket',
    description: 'Repro steps long enough here',
    createdBy: actor._id,
    watchers: [watcher._id],
    severity: 'Minor',
    priority: 'Low',
    status: 'pending',
    comments: [{
      content: 'Please verify the fix on staging.',
      commentedBy: actor._id,
      createdAt: new Date(),
    }],
  });

  const commentId = ticket.comments[0]._id;
  const doc = await resolveTicketDocForNotifications(ticket.ticketId);

  await dispatchTicketEvent({
    event: {
      type: 'TICKET_COMMENTED',
      commentId: String(commentId),
      requestId: 'test-req',
    },
    ticket: doc,
    actor,
    config: testConfig,
  });

  const rows = await Notification.find({ user: watcher._id }).lean();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].event, 'TICKET_COMMENTED');
  assert.equal(rows[0].title, 'Commenter commented on WEB-99');
  assert.equal(rows[0].body, 'Comment ticket — Please verify the fix on staging.');
  assert.match(rows[0].link, new RegExp(`&comment=${commentId}$`));
});
