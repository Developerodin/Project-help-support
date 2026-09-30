import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { ROLE_IDS } from '@pms/shared';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import Ticket from '../ticket.model.js';
import Client from '../../clients/client.model.js';
import AccessAssignment from '../../access/accessAssignment.model.js';
import TicketReadState from '../ticket-read-state.model.js';
import { addComment } from '../comment.service.js';
import {
  markDiscussionRead,
  DISCUSSION_READ_BASELINE_AT,
  discussionUnreadByTicketIds,
} from '../discussion-read.service.js';
import { listTickets } from '../ticket.service.js';
import { generateAccessToken } from '../../auth/token.service.js';
import { loadConfig } from '../../../platform/config.js';
import { testEnv } from '../../../test/test-env.js';

withMemoryDb();

const password = 'a-long-enough-password';

async function devUser(emailSuffix = Math.random().toString(36).slice(2)) {
  return User.create({
    name: 'Dev',
    email: `dev-${emailSuffix}@example.com`,
    password,
    role: ROLE_IDS.DEVELOPER,
    status: 'active',
  });
}

async function adminUser(emailSuffix = Math.random().toString(36).slice(2)) {
  return User.create({
    name: 'Admin',
    email: `admin-${emailSuffix}@example.com`,
    password,
    role: ROLE_IDS.ADMIN,
    status: 'active',
  });
}

async function ticketFixture() {
  const reporter = await devUser();
  const replier = await adminUser();
  const project = await Project.create({ key: 'WEB', name: 'Web', createdBy: reporter._id });
  await Ticket.init();
  const ticket = await Ticket.create({
    ticketId: 'WEB-1',
    project: project._id,
    title: 'Discussion unread fixture',
    description: 'Enough text for validation',
    createdBy: reporter._id,
    assignedTo: reporter._id,
    status: 'pending',
  });
  return { reporter, replier, project, ticket };
}

async function pushComment(ticket, by, content, { internal = false } = {}) {
  const actor = await User.findById(by);
  return addComment(actor, String(ticket._id), { content, internal });
}

test('unread count increments when another user comments', async () => {
  const { reporter, replier, ticket } = await ticketFixture();
  await pushComment(ticket, replier._id, 'Hello from dev');

  const page = await listTickets(reporter, {});
  const row = page.results.find((t) => t.ticketId === 'WEB-1');
  assert.equal(row.discussionUnreadCount, 1);
  assert.equal(row.hasNewReply, true);
  assert.equal(row.lastUnreadCommentAuthor, 'Admin');
});

test('own comments do not count as unread', async () => {
  const { reporter, replier, ticket } = await ticketFixture();
  await pushComment(ticket, reporter._id, 'My note');
  await pushComment(ticket, replier._id, 'Reply');

  const page = await listTickets(reporter, {});
  const row = page.results.find((t) => t.ticketId === 'WEB-1');
  assert.equal(row.discussionUnreadCount, 1);
});

test('mark discussion read clears unread and is idempotent', async () => {
  const { reporter, replier, ticket } = await ticketFixture();
  await pushComment(ticket, replier._id, 'Ping');

  await markDiscussionRead(reporter, String(ticket._id));
  let page = await listTickets(reporter, {});
  let row = page.results.find((t) => t.ticketId === 'WEB-1');
  assert.equal(row.discussionUnreadCount, 0);
  assert.equal(row.hasNewReply, false);

  const revisionBefore = (await Ticket.findById(ticket._id)).revision;
  await markDiscussionRead(reporter, String(ticket._id));
  const revisionAfter = (await Ticket.findById(ticket._id)).revision;
  assert.equal(revisionBefore, revisionAfter);

  await markDiscussionRead(reporter, String(ticket._id));
  page = await listTickets(reporter, {});
  row = page.results.find((t) => t.ticketId === 'WEB-1');
  assert.equal(row.discussionUnreadCount, 0);
});

test('internal comments are invisible to external viewers for unread', async () => {
  const staff = await adminUser();
  const client = await Client.create({ name: 'Co', status: 'active', createdBy: staff._id });
  const project = await Project.create({
    key: 'CLI', name: 'Client proj', client: client._id, createdBy: staff._id,
  });
  const external = await User.create({
    name: 'Client',
    email: `client-${Math.random().toString(36).slice(2)}@example.com`,
    password,
    role: ROLE_IDS.CLIENT,
    status: 'active',
  });
  await AccessAssignment.create({
    user: external._id,
    client: client._id,
    role: ROLE_IDS.CLIENT,
    grantedBy: staff._id,
  });

  const ticket = await Ticket.create({
    ticketId: 'CLI-1',
    project: project._id,
    title: 'External visibility',
    description: 'Long enough description',
    createdBy: external._id,
    status: 'under_review',
  });

  await pushComment(ticket, staff._id, 'Public reply', { internal: false });
  await pushComment(ticket, staff._id, 'Internal only', { internal: true });

  const page = await listTickets(external, {});
  const row = page.results.find((t) => t.ticketId === 'CLI-1');
  assert.equal(row.discussionUnreadCount, 1);
});

test('newReply filter combines with project scope', async () => {
  const { reporter, replier, ticket, project } = await ticketFixture();
  const otherProject = await Project.create({ key: 'MOB', name: 'Mob', createdBy: reporter._id });
  await Ticket.create({
    ticketId: 'MOB-9',
    project: otherProject._id,
    title: 'Other',
    description: 'Other ticket here',
    createdBy: reporter._id,
    status: 'pending',
  });
  await pushComment(ticket, replier._id, 'Unread on WEB');

  const page = await listTickets(reporter, { newReply: true, project: String(project._id) });
  assert.deepEqual(page.results.map((t) => t.ticketId), ['WEB-1']);
});

test('impersonation marks read for the impersonated user', async () => {
  const { reporter, replier, ticket } = await ticketFixture();
  const admin = await devUser();
  await pushComment(ticket, replier._id, 'For impersonated user');

  const config = loadConfig(testEnv);
  const token = generateAccessToken(reporter, config, { impersonatedBy: admin._id });
  assert.ok(token);

  await markDiscussionRead(reporter, String(ticket._id));
  const state = await TicketReadState.findOne({ user: reporter._id, ticket: ticket._id }).lean();
  assert.ok(state);
  assert.ok(state.lastReadAt >= DISCUSSION_READ_BASELINE_AT);
});

test('a watcher who is neither raiser nor tester sees hasNewReply', async () => {
  const reporter = await devUser();
  const watcher = await devUser();
  const replier = await adminUser();
  const project = await Project.create({ key: 'WAT', name: 'Watch', createdBy: reporter._id });
  const ticket = await Ticket.create({
    ticketId: 'WAT-1',
    project: project._id,
    title: 'Watcher is audience',
    description: 'Enough text for validation',
    createdBy: reporter._id,
    watchers: [watcher._id],
    status: 'pending',
  });
  await pushComment(ticket, replier._id, 'Hello watcher should see this');

  const page = await listTickets(watcher, {});
  const row = page.results.find((t) => t.ticketId === 'WAT-1');
  assert.equal(row.discussionUnreadCount, 1);
  assert.equal(row.hasNewReply, true);
  assert.equal(row.lastUnreadCommentAuthor, 'Admin');

  await markDiscussionRead(watcher, 'WAT-1');
  const after = await listTickets(watcher, {});
  assert.equal(after.results.find((t) => t.ticketId === 'WAT-1').discussionUnreadCount, 0);
});

test('assignee who is not raiser or tester does not see hasNewReply', async () => {
  const reporter = await devUser();
  const assignee = await devUser();
  const replier = await adminUser();
  const project = await Project.create({ key: 'ASN', name: 'Assign', createdBy: reporter._id });
  const ticket = await Ticket.create({
    ticketId: 'ASN-1',
    project: project._id,
    title: 'Assignee is not audience',
    description: 'Enough text for validation',
    createdBy: reporter._id,
    assignedTo: assignee._id,
    status: 'pending',
  });
  await pushComment(ticket, replier._id, 'Hello assignee should not see this');

  const page = await listTickets(assignee, {});
  const row = page.results.find((t) => t.ticketId === 'ASN-1');
  assert.equal(row.discussionUnreadCount, 0);
  assert.equal(row.hasNewReply, false);
});

test('testedBy tester sees unread when someone else comments', async () => {
  const reporter = await devUser();
  const tester = await devUser();
  const replier = await adminUser();
  const project = await Project.create({ key: 'QA', name: 'QA', createdBy: reporter._id });
  const ticket = await Ticket.create({
    ticketId: 'QA-1',
    project: project._id,
    title: 'Tester audience',
    description: 'Enough text for validation',
    createdBy: reporter._id,
    assignedTo: reporter._id,
    testedBy: tester._id,
    status: 'pending',
  });
  await pushComment(ticket, replier._id, 'For the tester');

  const page = await listTickets(tester, {});
  const row = page.results.find((t) => t.ticketId === 'QA-1');
  assert.equal(row.discussionUnreadCount, 1);
  assert.equal(row.hasNewReply, true);
});

test('newReply filter excludes tickets where viewer is not raiser or tester', async () => {
  const reporter = await devUser();
  const assignee = await devUser();
  const replier = await adminUser();
  const project = await Project.create({ key: 'FLT', name: 'Filter', createdBy: reporter._id });
  const ticket = await Ticket.create({
    ticketId: 'FLT-1',
    project: project._id,
    title: 'Filter audience',
    description: 'Enough text for validation',
    createdBy: reporter._id,
    assignedTo: assignee._id,
    status: 'pending',
  });
  await pushComment(ticket, replier._id, 'Unread for reporter only');

  const assigneePage = await listTickets(assignee, { newReply: true });
  assert.equal(assigneePage.results.length, 0);

  const reporterPage = await listTickets(reporter, { newReply: true });
  assert.deepEqual(reporterPage.results.map((t) => t.ticketId), ['FLT-1']);
});

test('list sort by discussion unread count puts higher unread first', async () => {
  const { reporter, replier, ticket, project } = await ticketFixture();
  const quiet = await Ticket.create({
    ticketId: 'WEB-2',
    project: project._id,
    title: 'Quiet ticket',
    description: 'Enough text for validation',
    createdBy: reporter._id,
    assignedTo: reporter._id,
    status: 'pending',
  });
  await pushComment(ticket, replier._id, 'First unread');
  await pushComment(ticket, replier._id, 'Second unread');
  await pushComment(quiet, replier._id, 'Single unread');

  const page = await listTickets(reporter, { sortBy: 'discussionUnreadCount:desc' });
  assert.equal(page.results[0].ticketId, 'WEB-1');
  assert.equal(page.results[0].discussionUnreadCount, 2);
  assert.equal(page.results[1].ticketId, 'WEB-2');
  assert.equal(page.results[1].discussionUnreadCount, 1);
});

test('comments before baseline without read state are not unread', async () => {
  const { reporter, replier, ticket } = await ticketFixture();
  const old = new Date(DISCUSSION_READ_BASELINE_AT.getTime() - 86_400_000);
  const doc = await Ticket.findById(ticket._id);
  doc.comments.push({
    content: 'Ancient',
    commentedBy: replier._id,
    createdAt: old,
    internal: false,
  });
  await doc.save({ timestamps: false });

  const map = await discussionUnreadByTicketIds(reporter, [ticket._id]);
  assert.equal(map.get(String(ticket._id)).discussionUnreadCount, 0);
});

test('newReply filter works with a sort the aggregate path does not special-case', async () => {
  const { reporter, replier, ticket } = await ticketFixture();
  await pushComment(ticket, replier._id, 'Unread reply');

  // priority/estimatedResolutionAt fall through aggregateSortStages; combined
  // with newReply they used to spread a null sort stage and throw.
  for (const sortBy of ['priority:desc', 'estimatedResolutionAt:asc']) {
    const page = await listTickets(reporter, { newReply: true, sortBy });
    assert.deepEqual(page.results.map((t) => t.ticketId), ['WEB-1'], sortBy);
    assert.equal(page.totalResults, 1, sortBy);
  }
});

test('category totals narrow to unread tickets when the newReply filter is on', async () => {
  const { reporter, replier, ticket, project } = await ticketFixture();
  await Ticket.create({
    ticketId: 'WEB-3',
    project: project._id,
    title: 'Silent bug',
    description: 'Enough text for validation',
    category: 'Bug',
    createdBy: reporter._id,
    assignedTo: reporter._id,
    status: 'pending',
  });
  await Ticket.findByIdAndUpdate(ticket._id, { category: 'Bug' });
  await pushComment(ticket, replier._id, 'Unread reply');

  const all = await listTickets(reporter, {});
  assert.equal(all.categoryTotals.Bug, 2);

  const unreadOnly = await listTickets(reporter, { newReply: true });
  assert.equal(unreadOnly.categoryTotals.Bug, 1);
});
