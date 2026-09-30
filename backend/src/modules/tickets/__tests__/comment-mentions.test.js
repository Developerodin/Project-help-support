import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS } from '@pms/shared';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import Ticket from '../ticket.model.js';
import { addComment } from '../comment.service.js';

withMemoryDb();

const password = 'a-long-enough-password';

test('addComment stores mention ids on the comment', async () => {
  const author = await User.create({
    name: 'Author',
    email: `author-${Date.now()}@example.com`,
    password,
    role: ROLE_IDS.DEVELOPER,
    status: 'active',
  });
  const mentioned = await User.create({
    name: 'Mentioned',
    email: `mentioned-${Date.now()}@example.com`,
    password,
    role: ROLE_IDS.DEVELOPER,
    status: 'active',
  });
  const project = await Project.create({ key: 'WEB', name: 'Web', createdBy: author._id });
  await Ticket.init();
  const ticket = await Ticket.create({
    ticketId: 'WEB-77',
    project: project._id,
    title: 'Mention fixture',
    description: 'Enough text for validation',
    createdBy: author._id,
    assignedTo: author._id,
    status: 'pending',
  });

  const { comment, created } = await addComment(author, String(ticket._id), {
    content: 'Hey @Mentioned',
    mentions: [mentioned._id],
  });

  assert.equal(created, true);
  assert.equal(comment.mentions.length, 1);
  assert.equal(String(comment.mentions[0]), String(mentioned._id));
});
