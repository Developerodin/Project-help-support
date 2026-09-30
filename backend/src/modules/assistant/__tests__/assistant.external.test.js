import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { ROLE_IDS } from '@pms/shared';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Client from '../../clients/client.model.js';
import Project from '../../projects/project.model.js';
import Ticket from '../../tickets/ticket.model.js';
import AccessAssignment from '../../access/accessAssignment.model.js';
import ProjectTeamMember from '../../projects/project-team-member.model.js';
import { runTool, toolsFor } from '../assistant.tools.js';

/*
 * Guardrails for client (external) users talking to the assistant: whatever
 * they ask, the assistant must never reach another project, another company,
 * internal comments or internal files.
 */

withMemoryDb();

const user = (role) => User.create({
  name: role, email: `${role}-${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password', role, roles: [role], status: 'active',
});

async function seed() {
  const admin = await user(ROLE_IDS.ADMIN);
  const developer = await user(ROLE_IDS.DEVELOPER);
  const companyA = await Client.create({ name: 'Company A', createdBy: admin._id });
  const companyB = await Client.create({ name: 'Company B', createdBy: admin._id });
  const modules = [{ label: 'Chats', pages: [{ label: 'Inbox' }] }];
  const a1 = await Project.create({ key: 'A1', name: 'A One', client: companyA._id, createdBy: admin._id, modules });
  const a2 = await Project.create({ key: 'A2', name: 'A Two', client: companyA._id, createdBy: admin._id, modules });
  const b1 = await Project.create({ key: 'B1', name: 'B One', client: companyB._id, createdBy: admin._id, modules });

  // Project-scoped tester: A1 only, not its sibling A2, not company B.
  const tester = await user(ROLE_IDS.CLIENT_TESTER);
  await AccessAssignment.create({
    user: tester._id, role: ROLE_IDS.CLIENT_TESTER, client: companyA._id, project: a1._id, grantedBy: admin._id,
  });

  const internalFileId = new mongoose.Types.ObjectId();
  const internalFile = {
    _id: internalFileId, key: 'k-internal', name: 'internal-notes.pdf', mimeType: 'application/pdf', uploadedBy: developer._id,
  };
  await Ticket.create([
    {
      ticketId: 'A1-1', project: a1._id, title: 'Inbox is empty', description: 'Shows nothing.',
      createdBy: tester._id, severity: 'Minor', priority: 'Low', status: 'pending',
      attachments: [internalFile],
      comments: [
        { content: 'Visible reply', commentedBy: developer._id },
        { content: 'SECRET internal triage note', commentedBy: developer._id, internal: true, attachments: [internalFile] },
      ],
    },
    {
      ticketId: 'A2-1', project: a2._id, title: 'Sibling project ticket', createdBy: developer._id,
      severity: 'Minor', priority: 'Low', status: 'pending',
    },
    {
      ticketId: 'B1-1', project: b1._id, title: 'Other company ticket', createdBy: developer._id,
      severity: 'Minor', priority: 'Low', status: 'pending',
    },
  ]);
  return { admin, tester, internalFileId: String(internalFileId) };
}

const ctxFor = (actor) => ({
  config: { storage: null }, user: actor, permissionContext: null, actions: [], projects: null, clients: null,
});
const call = (actor, name, args = {}) => runTool(name, JSON.stringify(args), ctxFor(actor));
const search = (over) => ({
  query: null, project_key: null, stage: null, priority: null, module: null,
  overdue: null, blocked: null, scope: null, new_reply: null, ...over,
});

test('a client tester is offered no admin or edit tools, and naming one is refused', async () => {
  const { tester } = await seed();
  const offered = toolsFor(tester, null).map((tool) => tool.name);
  for (const forbidden of ['search_users', 'list_teams', 'list_clients', 'propose_update_ticket',
    'propose_create_project', 'propose_create_team', 'propose_client_brand']) {
    assert.equal(offered.includes(forbidden), false, forbidden);
    assert.match((await call(tester, forbidden)).error, /not available/, forbidden);
  }
});

test('projects and ticket search stay inside the tester\'s own project', async () => {
  const { tester } = await seed();

  assert.deepEqual((await call(tester, 'list_projects')).map((p) => p.key), ['A1']);
  assert.deepEqual((await call(tester, 'search_tickets', search())).tickets.map((t) => t.id), ['A1-1']);
  for (const query of ['A2-1', 'B1-1', 'Sibling', 'Other company']) {
    assert.equal((await call(tester, 'search_tickets', search({ query }))).tickets.length, 0, query);
  }
  for (const key of ['A2', 'B1']) {
    assert.match((await call(tester, 'search_tickets', search({ project_key: key }))).error, /No accessible project/, key);
  }
});

test('other projects\' tickets are unreachable, and indistinguishable from tickets that don\'t exist', async () => {
  const { tester } = await seed();
  const missing = await call(tester, 'get_ticket', { ticket_id: 'ZZ-999' });
  for (const ticketId of ['A2-1', 'B1-1']) {
    assert.deepEqual(await call(tester, 'get_ticket', { ticket_id: ticketId }), missing, ticketId);
    assert.deepEqual(await call(tester, 'get_ticket_discussion', { ticket_id: ticketId }), missing, ticketId);
    assert.match((await call(tester, 'propose_stage_change', { ticket_ids: [ticketId], to_stage: 'closed', note: null })).error, /not found|access|not available/i);
    assert.match((await call(tester, 'navigate', {
      destination: 'ticket', ticket_id: ticketId, ticket_tab: null, view: null, query: null, stage: null, priority: null,
      module: null, scope: null, overdue: null, blocked: null,
    })).error, /not found|access/i);
  }
});

test('internal comments and internal files never reach a client through the assistant', async () => {
  const { admin, tester, internalFileId } = await seed();

  // Control: the secret really is on the ticket, so its absence below is the filtering at work.
  const asAdmin = JSON.stringify(await call(admin, 'get_ticket_discussion', { ticket_id: 'A1-1' }));
  assert.match(asAdmin, /SECRET/);
  assert.match(asAdmin, /internal-notes\.pdf/);

  const ticket = await call(tester, 'get_ticket', { ticket_id: 'A1-1' });
  const discussion = await call(tester, 'get_ticket_discussion', { ticket_id: 'A1-1' });
  const everything = JSON.stringify([ticket, discussion]);
  assert.doesNotMatch(everything, /SECRET/);
  assert.doesNotMatch(everything, /internal-notes\.pdf/);
  assert.deepEqual(discussion.comments.map((c) => c.text), ['Visible reply']);

  const open = await call(tester, 'open_attachment', { ticket_id: 'A1-1', attachment_id: internalFileId });
  assert.match(open.error, /No such file/);
});

test('a client can only draft tickets in their own project', async () => {
  const { tester } = await seed();
  const draft = (projectKey) => call(tester, 'propose_create_ticket', {
    project_key: projectKey, title: 'Inbox broken', description: 'The inbox never loads for me.',
    steps_to_reproduce: null, module: 'Chats', page: 'Inbox', category: 'Bug', priority: 'Low', severity: 'Minor',
    environment: null,
  });
  assert.match((await draft('B1')).error, /No accessible project/);
  assert.match((await draft('A2')).error, /No accessible project/);
  assert.equal((await draft('A1')).status, 'proposed');
});

test('voice navigation never sends a client to internal pages', async () => {
  const { tester } = await seed();
  const go = (destination) => call(tester, 'navigate', {
    destination, ticket_id: null, ticket_tab: null, view: null, query: null, stage: null, priority: null,
    module: null, scope: null, overdue: null, blocked: null,
  });
  for (const internalPage of ['users', 'teams', 'projects', 'analytics']) {
    assert.match((await go(internalPage)).error, /doesn't have access/, internalPage);
  }
  assert.equal((await go('notifications')).status, 'opened');
});

test('project switching: own projects only, and "all projects" is for internal users', async () => {
  const { admin, tester } = await seed();
  const switchTo = async (actor, key) => {
    const ctx = ctxFor(actor);
    const result = await runTool('switch_project', JSON.stringify({ project_key: key }), ctx);
    return { result, actions: ctx.actions };
  };

  const own = await switchTo(tester, 'a1');
  assert.equal(own.result.status, 'switched');
  assert.equal(own.actions[0].type, 'switch_project');
  assert.ok(own.actions[0].projectId);
  for (const key of ['A2', 'B1']) {
    const other = await switchTo(tester, key);
    assert.match(other.result.error, /No accessible project/, key);
    assert.equal(other.actions.length, 0, key);
  }
  assert.match((await switchTo(tester, null)).result.error, /one project at a time/);

  const all = await switchTo(admin, null);
  assert.deepEqual(all.actions.map((a) => a.projectId), [null]);
});

test('ticket actions: a client may comment and attach on their own tickets, nothing more', async () => {
  const { tester } = await seed();
  const offered = toolsFor(tester, null).map((tool) => tool.name);
  assert.ok(offered.includes('propose_comment') && offered.includes('propose_attach_files'));
  for (const internalOnly of ['propose_assign', 'propose_block', 'watch_ticket']) {
    assert.equal(offered.includes(internalOnly), false, internalOnly);
  }

  const ctx = ctxFor(tester);
  const posted = await runTool('propose_comment', JSON.stringify({ ticket_id: 'A1-1', text: 'Still broken for me', internal: null, mention: null }), ctx);
  assert.equal(posted.status, 'proposed');
  assert.deepEqual(ctx.actions.map((a) => [a.type, a.ticketId, a.internal]), [['comment', 'A1-1', false]]);
  assert.match((await call(tester, 'propose_comment', { ticket_id: 'A1-1', text: 'psst', internal: true, mention: null })).error, /internal/);
  assert.match((await call(tester, 'propose_comment', { ticket_id: 'B1-1', text: 'hello', internal: null, mention: null })).error, /not found|access/i);
  assert.match((await call(tester, 'propose_attach_files', { ticket_id: 'A2-1', note: null })).error, /not found|access/i);
});

test('assigning matches a person on the project team, and refuses anyone else', async () => {
  const { admin } = await seed();
  const a1 = await Project.findOne({ key: 'A1' });
  const riya = await user(ROLE_IDS.DEVELOPER);
  await User.updateOne({ _id: riya._id }, { name: 'Riya Sharma' });
  const outsider = await user(ROLE_IDS.DEVELOPER);
  await User.updateOne({ _id: outsider._id }, { name: 'Riya Outsider' });
  await ProjectTeamMember.create({ project: a1._id, team: new mongoose.Types.ObjectId(), user: riya._id, role: 'developer' });

  const ctx = ctxFor(admin);
  const drafted = await runTool('propose_assign', JSON.stringify({ ticket_ids: ['a1-1'], assignee: 'riya' }), ctx);
  assert.equal(drafted.status, 'proposed');
  assert.deepEqual(ctx.actions[0], {
    id: ctx.actions[0].id, type: 'assign', ticketIds: ['A1-1'], from: [null], assigneeId: String(riya._id), assigneeName: 'Riya Sharma',
  });
  // Riya isn't on A2's team, so a bulk change across both is refused.
  assert.match((await call(admin, 'propose_assign', { ticket_ids: ['A1-1', 'A2-1'], assignee: 'Riya' })).error, /every one/);
  assert.match((await call(admin, 'propose_assign', { ticket_ids: ['A1-1'], assignee: 'Nobody' })).error, /Team members: Riya Sharma/);
  const unassign = ctxFor(admin);
  await runTool('propose_assign', JSON.stringify({ ticket_ids: ['A1-1'], assignee: null }), unassign);
  assert.equal(unassign.actions[0].assigneeId, null);
});

test('blocking needs a reason, and field edits check the due date format', async () => {
  const { admin } = await seed();
  assert.match((await call(admin, 'propose_block', { ticket_id: 'A1-1', blocked: true, reason: null })).error, /blocked on/);
  assert.match((await call(admin, 'propose_block', { ticket_id: 'A1-1', blocked: false, reason: null })).error, /already not blocked/);
  const update = (over) => call(admin, 'propose_update_ticket', {
    ticket_id: 'A1-1', title: null, description: null, steps_to_reproduce: null, priority: null, severity: null,
    category: null, environment: null, module: null, page: null, due_date: null, ...over,
  });
  assert.match((await update({ due_date: 'next friday' })).error, /YYYY-MM-DD/);
  assert.equal((await update({ due_date: '2026-10-02', environment: 'Production' })).status, 'proposed');
});

test('attaching files needs the right ticket and project, checked before any card is drafted', async () => {
  const { admin, tester } = await seed();
  const attach = async (actor, ticketId, projectKey) => {
    const ctx = ctxFor(actor);
    const result = await runTool('propose_attach_files', JSON.stringify({ ticket_id: ticketId, project_key: projectKey, note: null }), ctx);
    return { result, actions: ctx.actions };
  };

  const ok = await attach(tester, 'A1-1', 'a1');
  assert.equal(ok.result.status, 'proposed');
  assert.deepEqual(ok.result.verified, { ticket: 'A1-1', title: 'Inbox is empty', project: 'A1 A One' });
  assert.deepEqual([ok.actions[0].type, ok.actions[0].projectKey], ['attach_files', 'A1']);

  const wrongProject = await attach(admin, 'A1-1', 'A2');
  assert.match(wrongProject.result.error, /is in project A1, not A2/);
  assert.equal(wrongProject.actions.length, 0);
  assert.match((await attach(tester, 'A1-1', 'B1')).result.error, /No accessible project/);
});

test('stage moves through the assistant: clients only close Live (with a reason), admins anywhere', async () => {
  const { admin, tester } = await seed();
  const move = (actor, to, note = null) => call(actor, 'propose_stage_change', { ticket_ids: ['A1-1'], to_stage: to, note });

  await Ticket.updateOne({ ticketId: 'A1-1' }, { $set: { status: 'closed' } });
  assert.match((await move(tester, 'in_progress', 'Broken again')).error, /not available|only move Live tickets to Closed/);

  // Admin: straight from Closed back to Pending, which lane rules never allowed; a note is still required.
  assert.match((await move(admin, 'pending')).error, /needs a note/);
  assert.equal((await move(admin, 'pending', 'Re-triage')).status, 'proposed');
});

test('recent comments across a project: newest first, the client never sees internal notes or other projects', async () => {
  const { admin, tester } = await seed();
  await Ticket.updateMany({}, { $set: { updatedAt: new Date() } });

  const asAdmin = await call(admin, 'recent_comments', { project_key: null, days: null, only_unread: null });
  assert.equal(asAdmin.total, 2);
  assert.ok(asAdmin.comments.some((c) => /SECRET/.test(c.text)));
  assert.deepEqual(Object.keys(asAdmin.comments[0]).sort(),
    ['at', 'by', 'files', 'internal', 'stage', 'text', 'ticket', 'ticket_title']);

  const asClient = await call(tester, 'recent_comments', { project_key: 'A1', days: 7, only_unread: null });
  assert.deepEqual(asClient.comments.map((c) => c.text), ['Visible reply']);
  assert.match((await call(tester, 'recent_comments', { project_key: 'B1', days: null, only_unread: null })).error, /No accessible project/);
  assert.doesNotMatch(JSON.stringify(await call(tester, 'recent_comments', { project_key: null, days: null, only_unread: null })), /SECRET|A2-1|B1-1/);
});

test('a drafted reply can @mention someone on the ticket, and only them', async () => {
  const { tester } = await seed();
  const ctx = ctxFor(tester);
  // The developer who replied on A1-1 is named after their role in the seed.
  await runTool('propose_comment', JSON.stringify({
    ticket_id: 'A1-1', text: 'Thanks, checking now.', internal: null, mention: [ROLE_IDS.DEVELOPER],
  }), ctx);
  const [draft] = ctx.actions;
  assert.equal(draft.content, `@${ROLE_IDS.DEVELOPER} Thanks, checking now.`);
  assert.equal(draft.mentions.length, 1);
  assert.match((await call(tester, 'propose_comment', {
    ticket_id: 'A1-1', text: 'hi', internal: null, mention: ['Nobody'],
  })).error, /No one called "Nobody"/);
});

test('several tickets move on one card; ones that can\'t move are left off with the reason', async () => {
  const { admin } = await seed();
  const ctx = ctxFor(admin);
  const result = await runTool('propose_stage_change', JSON.stringify({
    ticket_ids: ['A1-1', 'a2-1', 'ZZ-9'], to_stage: 'under_review', note: null,
  }), ctx);
  assert.equal(result.status, 'proposed');
  assert.deepEqual(ctx.actions[0].ticketIds, ['A1-1', 'A2-1']);
  assert.deepEqual(ctx.actions[0].froms, ['pending', 'pending']);
  assert.deepEqual(result.left_off.map((entry) => entry.ticket), ['ZZ-9']);

  // Nothing movable: one clear refusal, and no card.
  const none = ctxFor(admin);
  const refused = await runTool('propose_stage_change', JSON.stringify({ ticket_ids: ['A1-1', 'A2-1'], to_stage: 'pending', note: null }), none);
  assert.match(refused.error, /None of these can move to Pending/);
  assert.equal(none.actions.length, 0);
});

test('admins always get the stage-move tool, even if the role matrix drops boards.use', async () => {
  const { admin } = await seed();
  const ctx = { roleMatrix: { [ROLE_IDS.ADMIN]: [] }, userOverrides: {}, loadFailed: false };
  assert.ok(toolsFor(admin, ctx).some((tool) => tool.name === 'propose_stage_change'));
});

test('a move blocked by missing estimate dates can set them on the same card', async () => {
  const { admin } = await seed();
  await Ticket.updateOne({ ticketId: 'A1-1' }, { $set: { assignedTo: admin._id } });
  const move = async (over) => {
    const ctx = ctxFor(admin);
    const result = await runTool('propose_stage_change', JSON.stringify({
      ticket_ids: ['A1-1'], to_stage: 'ready_production', note: null, due_date: null, release_date: null, ...over,
    }), ctx);
    return { result, actions: ctx.actions };
  };

  const blocked = await move({});
  assert.match(blocked.result.error, /estimated resolution date and an expected release date/);
  assert.match(blocked.result.error, /Offer to set them/);

  const withDates = await move({ due_date: '2026-09-29', release_date: '2026-10-06' });
  assert.equal(withDates.result.status, 'proposed');
  assert.deepEqual(withDates.actions[0].dates, { due: '2026-09-29', release: '2026-10-06' });

  assert.match((await move({ due_date: '2026-10-06', release_date: '2026-09-29' })).result.error, /can't be before/);
  assert.match((await move({ due_date: 'next tuesday', release_date: '2026-10-06' })).result.error, /YYYY-MM-DD/);
});
