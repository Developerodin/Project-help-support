import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { ROLE_IDS } from '@pms/shared';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import Ticket from '../ticket.model.js';
import Team from '../../teams/team.model.js';
import {
  getTicket,
  listTickets,
  resolveTicketDoc,
  buildTicketFilter,
  ticketSearchClause,
} from '../ticket.service.js';

withMemoryDb();

const user = () => User.create({
  name: 'Ada', email: `${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password', status: 'active', role: 'developer',
});

async function fixture() {
  const actor = await user();
  const other = await user();
  const web = await Project.create({ key: 'WEB', name: 'Web App', createdBy: actor._id });
  const mob = await Project.create({ key: 'MOB', name: 'Mobile App', createdBy: actor._id });

  await Ticket.init();   // build the declared indexes before the list queries run
  await Ticket.create([
    {
      ticketId: 'WEB-101', project: web._id, title: 'Login button does nothing',
      description: 'Clicking sign in is inert', createdBy: actor._id,
      severity: 'Critical', priority: 'Urgent', status: 'pending',
    },
    {
      ticketId: 'WEB-102', project: web._id, title: 'Slow dashboard',
      createdBy: other._id, assignedTo: actor._id, status: 'in_progress',
      severity: 'Minor', priority: 'Low',
    },
    {
      ticketId: 'MOB-1', project: mob._id, title: 'Crash on launch',
      createdBy: other._id, status: 'pending', severity: 'Critical',
    },
  ]);

  return { actor, other, web, mob };
}

test('resolveTicketDoc accepts a Mongo id and a human ticketId', async () => {
  await fixture();
  const byKey = await resolveTicketDoc('WEB-101');
  const byId = await resolveTicketDoc(String(byKey._id));

  assert.equal(String(byId._id), String(byKey._id));
});

test('resolveTicketDoc is case-insensitive on the human id', async () => {
  await fixture();
  assert.equal((await resolveTicketDoc('web-101')).ticketId, 'WEB-101');
});

test('resolveTicketDoc throws 404 for both forms when missing', async () => {
  await fixture();
  await assert.rejects(
    () => resolveTicketDoc('WEB-9999'),
    (err) => err.statusCode === 404 && err.code === 'TICKET_NOT_FOUND',
  );
  await assert.rejects(
    () => resolveTicketDoc(String(new mongoose.Types.ObjectId())),
    (err) => err.statusCode === 404,
  );
});

test('getTicket returns revision so the client can send it back', async () => {
  const { actor } = await fixture();
  assert.equal((await getTicket(actor, 'WEB-101')).revision, 0);
});

test('getTicket rejects a member with no relationship to the ticket', async () => {
  const { other } = await fixture();
  await assert.rejects(
    () => getTicket(other, 'WEB-101'),
    (err) => err.statusCode === 403 && err.code === 'FORBIDDEN',
  );
});

test('q matches the text index', async () => {
  const { actor } = await fixture();
  const page = await listTickets(actor, { q: 'dashboard' });
  assert.deepEqual(page.results.map((t) => t.ticketId), ['WEB-102']);
});

test('q matches an exact ticketId that no text index would find', async () => {
  const { actor } = await fixture();
  const page = await listTickets(actor, { q: 'WEB-101' });
  assert.deepEqual(page.results.map((t) => t.ticketId), ['WEB-101']);
});

test('filters compose', async () => {
  const { actor, web } = await fixture();
  const page = await listTickets(actor, {
    project: String(web._id), severity: 'Critical', status: 'pending',
  });
  assert.deepEqual(page.results.map((t) => t.ticketId), ['WEB-101']);
});

test('categoryTotals count only pending-through-ready_qa stages', async () => {
  const actor = await user();
  const web = await Project.create({ key: 'WEB', name: 'Web App', createdBy: actor._id });
  await Ticket.init();
  await Ticket.create([
    {
      ticketId: 'WEB-301', project: web._id, title: 'Bug pending',
      createdBy: actor._id, category: 'Bug', status: 'pending',
    },
    {
      ticketId: 'WEB-302', project: web._id, title: 'Bug ready qa',
      createdBy: actor._id, category: 'Bug', status: 'ready_qa',
    },
    {
      ticketId: 'WEB-303', project: web._id, title: 'Bug staging',
      createdBy: actor._id, category: 'Bug', status: 'deployed_staging',
    },
    {
      ticketId: 'WEB-304', project: web._id, title: 'Improvement in progress',
      createdBy: actor._id, category: 'Improvement', status: 'in_progress',
    },
    {
      ticketId: 'WEB-305', project: web._id, title: 'Improvement live',
      createdBy: actor._id, category: 'Improvement', status: 'live',
    },
    {
      ticketId: 'WEB-306', project: web._id, title: 'Feature under review',
      createdBy: actor._id, category: 'New Feature', status: 'under_review',
    },
    {
      ticketId: 'WEB-307', project: web._id, title: 'Feature closed',
      createdBy: actor._id, category: 'New Feature', status: 'closed',
    },
  ]);

  const page = await listTickets(actor, { project: String(web._id), status: 'closed' });

  assert.deepEqual(page.categoryTotals, {
    Bug: 2,
    Improvement: 1,
    'New Feature': 1,
  });
});

test('ticketId sort keeps totalResults and results aligned for string project id', async () => {
  const { actor, web } = await fixture();
  const page = await listTickets(actor, {
    project: String(web._id),
    sortBy: 'ticketId:desc',
  });

  assert.equal(page.totalResults, 2);
  assert.equal(page.results.length, 2);
  assert.deepEqual(page.results.map((t) => t.ticketId), ['WEB-102', 'WEB-101']);
});

test('pagination keeps page boundaries and totalResults aligned', async () => {
  const { actor, web } = await fixture();
  const page1 = await listTickets(actor, {
    project: String(web._id),
    page: 1,
    limit: 1,
    sortBy: 'ticketId:asc',
  });

  assert.equal(page1.page, 1);
  assert.equal(page1.limit, 1);
  assert.equal(page1.totalResults, 2);
  assert.equal(page1.totalPages, 2);
  assert.equal(page1.results.length, 1);
  assert.equal(page1.results[0].ticketId, 'WEB-101');

  const page2 = await listTickets(actor, {
    project: String(web._id),
    page: 2,
    limit: 1,
    sortBy: 'ticketId:asc',
  });
  assert.equal(page2.results.length, 1);
  assert.equal(page2.results[0].ticketId, 'WEB-102');
});

test('inStage sort uses currentStageEnteredAt', async () => {
  const { actor, web } = await fixture();
  await Ticket.updateOne({ ticketId: 'WEB-101' }, { currentStageEnteredAt: new Date('2024-01-01') });
  await Ticket.updateOne({ ticketId: 'WEB-102' }, { currentStageEnteredAt: new Date('2025-01-01') });

  const asc = await listTickets(actor, {
    project: String(web._id),
    sortBy: 'currentStageEnteredAt:asc',
  });
  assert.deepEqual(asc.results.map((t) => t.ticketId), ['WEB-101', 'WEB-102']);
});

test('owner sort orders by assignee display name', async () => {
  const actor = await User.create({
    name: 'Zara', email: `${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-long-enough-password', status: 'active', role: 'developer',
  });
  const assigneeA = await User.create({
    name: 'Alice', email: `${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-long-enough-password', status: 'active', role: 'developer',
  });
  const assigneeB = await User.create({
    name: 'Bob', email: `${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-long-enough-password', status: 'active', role: 'developer',
  });
  const web = await Project.create({ key: 'WEB', name: 'Web App', createdBy: actor._id });

  await Ticket.init();
  await Ticket.create([
    {
      ticketId: 'WEB-201', project: web._id, title: 'Bob ticket',
      createdBy: actor._id, assignedTo: assigneeB._id, status: 'pending',
    },
    {
      ticketId: 'WEB-202', project: web._id, title: 'Alice ticket',
      createdBy: actor._id, assignedTo: assigneeA._id, status: 'pending',
    },
    {
      ticketId: 'WEB-203', project: web._id, title: 'Unassigned',
      createdBy: actor._id, status: 'pending',
    },
  ]);

  const asc = await listTickets(actor, {
    project: String(web._id),
    sortBy: 'assignedTo:asc',
  });
  assert.deepEqual(asc.results.map((t) => t.ticketId), ['WEB-203', 'WEB-202', 'WEB-201']);
});

test('status sort follows pipeline order for asc and desc', async () => {
  const actor = await user();
  const web = await Project.create({ key: 'WEB', name: 'Web App', createdBy: actor._id });
  await Ticket.init();
  await Ticket.create([
    {
      ticketId: 'WEB-401', project: web._id, title: 'Closed ticket',
      createdBy: actor._id, status: 'closed',
    },
    {
      ticketId: 'WEB-402', project: web._id, title: 'Pending ticket',
      createdBy: actor._id, status: 'pending',
    },
    {
      ticketId: 'WEB-403', project: web._id, title: 'Under review ticket',
      createdBy: actor._id, status: 'under_review',
    },
    {
      ticketId: 'WEB-404', project: web._id, title: 'Ready production ticket',
      createdBy: actor._id, status: 'ready_production',
    },
  ]);

  const asc = await listTickets(actor, {
    project: String(web._id),
    sortBy: 'status:asc',
  });
  assert.deepEqual(asc.results.map((t) => t.status), [
    'pending',
    'under_review',
    'ready_production',
    'closed',
  ]);

  const desc = await listTickets(actor, {
    project: String(web._id),
    sortBy: 'status:desc',
  });
  assert.deepEqual(desc.results.map((t) => t.status), [
    'closed',
    'ready_production',
    'under_review',
    'pending',
  ]);
});

test('currentStageEnteredAt sort falls back to updatedAt for legacy tickets', async () => {
  const { actor, web } = await fixture();
  const older = new Date('2024-01-01');
  const newer = new Date('2025-01-01');

  await Ticket.collection.bulkWrite([
    {
      updateOne: {
        filter: { ticketId: 'WEB-101' },
        update: { $unset: { currentStageEnteredAt: '' }, $set: { updatedAt: older } },
      },
    },
    {
      updateOne: {
        filter: { ticketId: 'WEB-102' },
        update: { $set: { currentStageEnteredAt: newer, updatedAt: older } },
      },
    },
  ]);

  const page = await listTickets(actor, {
    project: String(web._id),
    sortBy: 'currentStageEnteredAt:desc',
  });

  assert.equal(page.totalResults, 2);
  assert.deepEqual(page.results.map((t) => t.ticketId), ['WEB-102', 'WEB-101']);
});

test('scope=assigned and scope=reported resolve against the actor, not the query', async () => {
  const { actor } = await fixture();

  const assigned = await listTickets(actor, { scope: 'assigned' });
  assert.deepEqual(assigned.results.map((t) => t.ticketId), ['WEB-102']);

  const reported = await listTickets(actor, { scope: 'reported' });
  assert.deepEqual(reported.results.map((t) => t.ticketId), ['WEB-101']);
});

test('scope=unassigned finds tickets with neither assignee nor team', async () => {
  const { actor } = await fixture();
  const page = await listTickets(actor, { scope: 'unassigned' });
  assert.deepEqual(page.results.map((t) => t.ticketId), ['WEB-101']);
});

test('members only see tickets they are related to', async () => {
  const { other } = await fixture();
  const page = await listTickets(other, {});
  assert.equal(page.totalResults, 2);
  assert.deepEqual(page.results.map((t) => t.ticketId).sort(), ['MOB-1', 'WEB-102']);
});

test('watchers can view and list tickets they watch', async () => {
  const { actor, other, web } = await fixture();
  await Ticket.updateOne({ ticketId: 'WEB-101' }, { $addToSet: { watchers: other._id } });

  const page = await listTickets(other, {});
  assert.ok(page.results.some((t) => t.ticketId === 'WEB-101'));
  assert.equal((await getTicket(other, 'WEB-101')).ticketId, 'WEB-101');
});

test('team members can view and list tickets assigned to their team', async () => {
  const { actor, other, web } = await fixture();
  const team = await Team.create({
    name: 'Platform', project: web._id, members: [other._id], createdBy: actor._id,
  });
  await Ticket.updateOne({ ticketId: 'WEB-101' }, { $set: { team: team._id } });

  const page = await listTickets(other, {});
  assert.ok(page.results.some((t) => t.ticketId === 'WEB-101'));
  assert.equal((await getTicket(other, 'WEB-101')).ticketId, 'WEB-101');
});

test('q matches the module field', async () => {
  const { actor, web } = await fixture();
  await Ticket.create({
    ticketId: 'WEB-201', project: web._id, title: 'Unrelated title',
    module: 'Authentication', createdBy: actor._id, status: 'pending',
  });

  const page = await listTickets(actor, { q: 'Authentication' });
  assert.deepEqual(page.results.map((t) => t.ticketId), ['WEB-201']);
});

test('overdue excludes closed and live tickets with past estimatedResolutionAt', async () => {
  const { actor, web } = await fixture();
  const past = new Date(Date.now() - 86400000);
  const future = new Date(Date.now() + 86400000);

  await Ticket.create([
    {
      ticketId: 'WEB-301', project: web._id, title: 'Overdue pending',
      createdBy: actor._id, status: 'pending', estimatedResolutionAt: past,
    },
    {
      ticketId: 'WEB-302', project: web._id, title: 'Past date but live',
      createdBy: actor._id, status: 'live', estimatedResolutionAt: past,
    },
    {
      ticketId: 'WEB-303', project: web._id, title: 'Past date but closed',
      createdBy: actor._id, status: 'closed', estimatedResolutionAt: past,
    },
    {
      ticketId: 'WEB-304', project: web._id, title: 'Future estimate',
      createdBy: actor._id, status: 'pending', estimatedResolutionAt: future,
    },
  ]);

  const page = await listTickets(actor, { overdue: true });
  assert.deepEqual(page.results.map((t) => t.ticketId), ['WEB-301']);
});

test('the list projection omits the embedded arrays', async () => {
  const { actor } = await fixture();
  const [first] = (await listTickets(actor, {})).results;

  assert.equal(first.comments, undefined);
  assert.equal(first.activityLog, undefined);
  assert.equal(first.stageHistory, undefined);
});

const roleUser = (role) => User.create({
  name: `${role} user`,
  email: `${role}-${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password',
  status: 'active',
  role,
});

test('testedBy grants list and view access without team membership', async () => {
  const reporter = await user();
  const developer = await roleUser('developer');
  const qa = await roleUser(ROLE_IDS.TESTER);
  const web = await Project.create({
    key: 'WEB',
    name: 'Web App',
    createdBy: reporter._id,
    defaultAssignee: developer._id,
    defaultTester: qa._id,
  });

  await Ticket.create({
    ticketId: 'WEB-401',
    project: web._id,
    title: 'Regression in checkout',
    createdBy: reporter._id,
    assignedTo: developer._id,
    testedBy: qa._id,
    status: 'ready_qa',
  });

  const page = await listTickets(qa, {});
  assert.deepEqual(page.results.map((t) => t.ticketId), ['WEB-401']);
  assert.equal((await getTicket(qa, 'WEB-401')).ticketId, 'WEB-401');
});

test('qa assignee can view via assignedTo without testedBy relationship', async () => {
  const reporter = await user();
  const qa = await roleUser(ROLE_IDS.TESTER);
  const web = await Project.create({ key: 'WEB', name: 'Web App', createdBy: reporter._id });

  await Ticket.create({
    ticketId: 'WEB-402',
    project: web._id,
    title: 'Hotfix verification',
    createdBy: reporter._id,
    assignedTo: qa._id,
    status: 'in_progress',
  });

  assert.equal((await getTicket(qa, 'WEB-402')).ticketId, 'WEB-402');
});

test('qa team member sees team tickets without personal assignment', async () => {
  const reporter = await user();
  const developer = await roleUser('developer');
  const qa = await roleUser(ROLE_IDS.TESTER);
  const web = await Project.create({ key: 'WEB', name: 'Web App', createdBy: reporter._id });
  const team = await Team.create({
    name: 'QA Squad',
    project: web._id,
    members: [qa._id, developer._id],
    createdBy: reporter._id,
  });

  await Ticket.create({
    ticketId: 'WEB-403',
    project: web._id,
    title: 'Shared backlog item',
    createdBy: reporter._id,
    assignedTo: developer._id,
    team: team._id,
    status: 'pending',
  });

  const page = await listTickets(qa, {});
  assert.deepEqual(page.results.map((t) => t.ticketId), ['WEB-403']);
});

test('team lead on ticket team can view without assignee or testedBy', async () => {
  const reporter = await user();
  const teamLead = await roleUser('developer');
  const web = await Project.create({ key: 'WEB', name: 'Web App', createdBy: reporter._id });
  const team = await Team.create({
    name: 'Platform',
    project: web._id,
    lead: teamLead._id,
    createdBy: reporter._id,
  });

  await Ticket.create({
    ticketId: 'WEB-404',
    project: web._id,
    title: 'Infra task',
    createdBy: reporter._id,
    team: team._id,
    status: 'pending',
  });

  assert.equal((await getTicket(teamLead, 'WEB-404')).ticketId, 'WEB-404');
});

test('team member sees a team-less ticket via the project\'s assigned team', async () => {
  const reporter = await user();
  const teammate = await roleUser('developer');
  const web = await Project.create({ key: 'WEB', name: 'Web App', createdBy: reporter._id });
  const team = await Team.create({
    name: 'Web Team',
    project: web._id,
    members: [reporter._id, teammate._id],
    createdBy: reporter._id,
  });
  await Project.findByIdAndUpdate(web._id, { team: team._id });

  await Ticket.create({
    ticketId: 'WEB-406',
    project: web._id,
    title: 'Filed with no team set',
    createdBy: reporter._id,
    team: null,
    status: 'pending',
  });

  const page = await listTickets(teammate, {});
  assert.deepEqual(page.results.map((t) => t.ticketId), ['WEB-406']);
  assert.equal((await getTicket(teammate, 'WEB-406')).ticketId, 'WEB-406');
});

test('developer outside project team cannot view unrelated tickets', async () => {
  const reporter = await user();
  const outsider = await roleUser('developer');
  const web = await Project.create({ key: 'WEB', name: 'Web App', createdBy: reporter._id });
  const mob = await Project.create({ key: 'MOB', name: 'Mobile App', createdBy: reporter._id });

  await Ticket.create({
    ticketId: 'MOB-9',
    project: mob._id,
    title: 'Mobile-only defect',
    createdBy: reporter._id,
    status: 'pending',
  });

  await assert.rejects(
    () => getTicket(outsider, 'MOB-9'),
    (err) => err.statusCode === 403 && err.code === 'FORBIDDEN',
  );
  assert.equal((await listTickets(outsider, {})).totalResults, 0);
});

test('qa testedBy on one ticket does not expose other tickets', async () => {
  const reporter = await user();
  const qa = await roleUser(ROLE_IDS.TESTER);
  const web = await Project.create({ key: 'WEB', name: 'Web App', createdBy: reporter._id });

  await Ticket.create([
    {
      ticketId: 'WEB-405',
      project: web._id,
      title: 'QA-owned ticket',
      createdBy: reporter._id,
      testedBy: qa._id,
      status: 'ready_qa',
    },
    {
      ticketId: 'WEB-406',
      project: web._id,
      title: 'Unrelated ticket',
      createdBy: reporter._id,
      status: 'pending',
    },
  ]);

  const page = await listTickets(qa, {});
  assert.deepEqual(page.results.map((t) => t.ticketId), ['WEB-405']);
  await assert.rejects(
    () => getTicket(qa, 'WEB-406'),
    (err) => err.statusCode === 403,
  );
});

/* ---------------------------------------------------------------------------
 * Search: number | title | module. Never description.
 * ------------------------------------------------------------------------ */

/** Sorted, because the default createdAt:desc sort ties inside one batch insert. */
const found = (page) => page.results.map((t) => t.ticketId).sort();

async function searchFixture() {
  const actor = await user();
  const outsider = await roleUser('developer');
  const web = await Project.create({ key: 'WEB', name: 'Web App', createdBy: actor._id });
  const mob = await Project.create({ key: 'MOB', name: 'Mobile App', createdBy: actor._id });
  const ats = await Project.create({ key: 'ATS', name: 'ATS App', createdBy: actor._id });

  await Ticket.init();
  await Ticket.create([
    {
      ticketId: 'WEB-63', project: web._id, module: 'Settings',
      title: 'Administrator Role-Settings-Attendance (half day)',
      createdBy: actor._id, status: 'pending',
    },
    {
      ticketId: 'ATS-63', project: ats._id, module: 'ATS',
      title: 'Interview scheduling', createdBy: actor._id, status: 'pending',
    },
    {
      // Near-miss for the number branch: "63" must not match 630.
      ticketId: 'WEB-630', project: web._id, module: 'Logs',
      title: 'Unrelated', createdBy: actor._id, status: 'pending',
    },
    {
      // The decoy the old $text branch matched on: every search word lives in
      // the description, and nowhere the user can see in the list.
      ticketId: 'MOB-8', project: mob._id, module: 'Communication',
      title: 'Chat Module – Restrict Contact Directory',
      description: 'Admin note: see WEB-63, the administrator role owns this',
      createdBy: actor._id, status: 'pending',
    },
    {
      ticketId: 'WEB-24', project: web._id, module: 'ATS',
      title: 'Administrator Role-Applications', createdBy: actor._id, status: 'pending',
    },
    {
      ticketId: 'WEB-8', project: web._id, module: 'MAIN',
      title: 'Employee Role Interface', createdBy: actor._id, status: 'pending',
    },
    {
      ticketId: 'WEB-9', project: web._id, module: 'MAIN',
      title: 'foobar baz', createdBy: actor._id, status: 'pending',
    },
  ]);

  return { actor, outsider, web, mob, ats };
}

test('search: prefixed ticket number matches only that ticket', async () => {
  const { actor } = await searchFixture();
  assert.deepEqual(found(await listTickets(actor, { q: 'WEB-63' })), ['WEB-63']);
  assert.deepEqual(found(await listTickets(actor, { q: 'web-63' })), ['WEB-63']);
});

test('search: a ticket number never matches description text', async () => {
  const { actor } = await searchFixture();
  // MOB-8's description contains "WEB-63" verbatim.
  assert.ok(!found(await listTickets(actor, { q: 'WEB-63' })).includes('MOB-8'));
});

test('search: bare number is the exact suffix across every project key', async () => {
  const { actor } = await searchFixture();
  const ids = found(await listTickets(actor, { q: '63' }));
  assert.deepEqual(ids, ['ATS-63', 'WEB-63']);
  assert.ok(!ids.includes('WEB-630'));
});

test('search: number tolerates a missing or spaced separator', async () => {
  const { actor } = await searchFixture();
  assert.deepEqual(found(await listTickets(actor, { q: 'web63' })), ['WEB-63']);
  assert.deepEqual(found(await listTickets(actor, { q: 'web 63' })), ['WEB-63']);
  assert.deepEqual(found(await listTickets(actor, { q: '  WEB-63  ' })), ['WEB-63']);
});

test('search: a bare project key matches ids and modules, not descriptions', async () => {
  const { actor } = await searchFixture();
  const ids = found(await listTickets(actor, { q: 'WEB' }));
  assert.deepEqual(ids, ['WEB-24', 'WEB-63', 'WEB-630', 'WEB-8', 'WEB-9']);
  assert.ok(!ids.includes('MOB-8'));
});

test('search: a partial word matches titles the text index could not', async () => {
  const { actor } = await searchFixture();
  const ids = found(await listTickets(actor, { q: 'Admin' }));
  assert.deepEqual(ids, ['WEB-24', 'WEB-63']);
  assert.ok(!ids.includes('MOB-8'));
});

test('search: module values match on a substring', async () => {
  const { actor } = await searchFixture();
  assert.deepEqual(found(await listTickets(actor, { q: 'Settings' })), ['WEB-63']);
  assert.deepEqual(found(await listTickets(actor, { q: 'ATS' })), ['ATS-63', 'WEB-24']);
});

test('search: every word is required, not any', async () => {
  const { actor } = await searchFixture();
  const both = found(await listTickets(actor, { q: 'administrator role' }));
  assert.deepEqual(both, ['WEB-24', 'WEB-63']);
  // WEB-8 has "Role" but not "administrator" — an OR would have returned it.
  assert.ok(!both.includes('WEB-8'));
  assert.ok(found(await listTickets(actor, { q: 'role' })).includes('WEB-8'));
});

test('search: unbalanced metacharacters are escaped, not executed', async () => {
  const { actor } = await searchFixture();
  assert.deepEqual(found(await listTickets(actor, { q: 'Attendance (' })), ['WEB-63']);
  assert.deepEqual(found(await listTickets(actor, { q: 'Attendance (half' })), ['WEB-63']);
});

test('search: metacharacters cannot widen the match', async () => {
  const { actor } = await searchFixture();
  // 'foo.*bar' must be a literal, so it matches nothing; 'foobar' still does.
  assert.deepEqual(found(await listTickets(actor, { q: 'foo.*bar' })), []);
  assert.deepEqual(found(await listTickets(actor, { q: 'foobar' })), ['WEB-9']);
});

test('search: a hyphen typed against an en-dash title still matches', async () => {
  const { actor } = await searchFixture();
  assert.deepEqual(found(await listTickets(actor, { q: 'Module - Restrict' })), ['MOB-8']);
});

test('search: only the first six words are applied', async () => {
  const { actor } = await searchFixture();
  const page = await listTickets(actor, {
    q: 'Administrator Role Settings Attendance half day zzzznope',
  });
  assert.deepEqual(found(page), ['WEB-63']);
  assert.equal(ticketSearchClause('aa bb cc dd ee ff gg hh').$and.length, 6);
});

test('search: a 200-character term stays bounded and matches nothing', async () => {
  const { actor } = await searchFixture();
  const long = 'zz '.repeat(66).trim();          // 66 words, 197 chars
  assert.equal(ticketSearchClause(long).$and.length, 6);
  assert.deepEqual(found(await listTickets(actor, { q: 'a'.repeat(200) })), []);
});

test('search: empty and whitespace-only queries produce no clause', async () => {
  const { actor } = await searchFixture();
  for (const q of ['', '   ', '-', ' – ', undefined, null]) {
    assert.equal(ticketSearchClause(q), null, `expected null for ${JSON.stringify(q)}`);
  }
  const all = found(await listTickets(actor, { q: '   ' }));
  assert.equal(all.length, 7);
});

test('search is ANDed with the actor visibility scope, never ORed', async () => {
  const { actor, outsider } = await searchFixture();

  // The same term the owner can see returns nothing for an unrelated developer.
  assert.deepEqual(found(await listTickets(outsider, { q: 'Administrator' })), []);
  assert.deepEqual(found(await listTickets(outsider, { q: 'WEB-63' })), []);
  assert.equal((await listTickets(outsider, { q: '63' })).totalResults, 0);
  assert.ok(found(await listTickets(actor, { q: 'Administrator' })).length > 0);
});

test('search composes with an existing filter without widening it', async () => {
  const { actor, web } = await searchFixture();
  const page = await listTickets(actor, { q: 'Administrator', module: 'ATS' });
  assert.deepEqual(found(page), ['WEB-24']);

  const scoped = await listTickets(actor, { q: 'Administrator', project: String(web._id) });
  assert.deepEqual(found(scoped), ['WEB-24', 'WEB-63']);
});

test('search keeps totalResults aligned with the page under a ticketId sort', async () => {
  const { actor } = await searchFixture();
  const page = await listTickets(actor, { q: 'Administrator', sortBy: 'ticketId:asc' });

  assert.equal(page.totalResults, 2);
  assert.equal(page.results.length, 2);
  assert.deepEqual(page.results.map((t) => t.ticketId), ['WEB-24', 'WEB-63']);
});

test('the ticket list filter no longer uses $text', async () => {
  const { actor } = await searchFixture();
  const filter = await buildTicketFilter(actor, { q: 'administrator role' });
  assert.ok(!JSON.stringify(filter).includes('$text'));
  assert.equal(filter.$or, undefined, 'search must not be assigned to filter.$or');
});
