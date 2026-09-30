import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS } from '@pms/shared';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import Team from '../../teams/team.model.js';
import Client from '../../clients/client.model.js';
import AccessAssignment from '../../access/accessAssignment.model.js';
import Ticket from '../ticket.model.js';
import { createTicket, getTicket, listTickets } from '../ticket.service.js';
import { transitionTicket, checkGuards } from '../transition.service.js';
import { addComment } from '../comment.service.js';
import { assignProjectTeam } from '../../projects/project-team-member.service.js';

withMemoryDb();

const IN_A_WEEK = new Date(Date.now() + 7 * 86400000);

/** External close/reopen requires tickets.accept — CLIENT_BUNDLE grants none by default. */
function externalAcceptCtx(role, { accept = true } = {}) {
  const permissions = accept ? ['tickets.view', 'tickets.accept'] : ['tickets.view'];
  return { roleMatrix: { [role]: permissions }, userOverrides: {}, scopedAssignments: [] };
}

const user = (role = ROLE_IDS.DEVELOPER) => User.create({
  name: role, email: `${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password', status: 'active', role,
});

async function seed({ estimates = true, owned = true } = {}) {
  const admin = await user(ROLE_IDS.ADMIN);
  const dev = await user(ROLE_IDS.DEVELOPER);
  const web = await Project.create({ key: 'WEB', name: 'Web App', createdBy: admin._id });

  const ticket = await createTicket(admin, {
    project: web.id,
    title: 'Broken login button',
    description: 'Expected login to succeed but the button does nothing when clicked.',
    ...(owned ? { assignedTo: dev._id } : {}),
  });

  if (estimates) {
    await Ticket.updateOne({ _id: ticket.id }, {
      $set: { estimatedResolutionAt: IN_A_WEEK, expectedReleaseDate: IN_A_WEEK },
    });
  }

  return { admin, dev, web, ticket };
}

const reload = (id) => Ticket.findById(id);

test('a legal transition writes the stage, bumps revision and appends history', async () => {
  const { admin, ticket } = await seed();

  const { ticket: moved, event } = await transitionTicket(admin, ticket.id, {
    to: 'under_review', revision: 0,
  });

  assert.equal(moved.status, 'under_review');
  assert.equal(moved.revision, 1);
  assert.equal(event.type, 'TICKET_STAGE_CHANGED');
  assert.equal(event.from, 'pending');
  assert.equal(event.to, 'under_review');

  const stored = await reload(ticket.id);
  assert.equal(stored.stageHistory.length, 2);
  assert.equal(stored.stageHistory.at(-1).from, 'pending');
  assert.equal(stored.stageHistory.at(-1).to, 'under_review');
});

test('a forward skip is allowed and records ONE history entry', async () => {
  const { admin, ticket } = await seed();

  await transitionTicket(admin, ticket.id, { to: 'live', revision: 0 });

  const stored = await reload(ticket.id);
  assert.equal(stored.status, 'live');
  assert.equal(stored.stageHistory.length, 2, 'skipped stages are never entered');
  assert.equal(stored.stageHistory.at(-1).from, 'pending');
});

test('the estimate guard anchors on the DESTINATION, so a skip cannot bypass it', async () => {
  const { admin, ticket } = await seed({ estimates: false });

  // pending -> in_progress skips under_review entirely; the old "required to
  // leave Under Review" phrasing would have let this through.
  await assert.rejects(
    () => transitionTicket(admin, ticket.id, { to: 'in_progress', revision: 0 }),
    (err) => err.statusCode === 400 && err.code === 'ESTIMATES_REQUIRED',
  );

  await assert.rejects(
    () => transitionTicket(admin, ticket.id, { to: 'live', revision: 0 }),
    (err) => err.code === 'ESTIMATES_REQUIRED',
  );

  // under_review is before the threshold, so it still works.
  const { ticket: moved } = await transitionTicket(admin, ticket.id, {
    to: 'under_review', revision: 0,
  });
  assert.equal(moved.status, 'under_review');
});

test('the estimate guard rejects release before resolution', async () => {
  const { admin, ticket } = await seed({ estimates: false });

  await Ticket.updateOne({ _id: ticket.id }, {
    $set: {
      estimatedResolutionAt: new Date('2026-08-19T00:00:00.000Z'),
      expectedReleaseDate: new Date('2026-08-18T00:00:00.000Z'),
    },
  });

  await assert.rejects(
    () => transitionTicket(admin, ticket.id, { to: 'in_progress', revision: 0 }),
    (err) => err.statusCode === 400
      && err.code === 'INVALID_ESTIMATE_DATES'
      && err.fields.expectedReleaseDate === 'Expected release cannot be before resolution estimate',
  );
});

test('checkGuards rejects invalid estimate ordering at guarded destinations', () => {
  const verdict = checkGuards('in_progress', {
    estimatedResolutionAt: new Date('2026-08-19T00:00:00.000Z'),
    expectedReleaseDate: new Date('2026-08-18T00:00:00.000Z'),
  });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, 'INVALID_ESTIMATE_DATES');
});

test('the ownership guard blocks entry to ready_qa with neither team nor assignee', async () => {
  const { admin, ticket } = await seed({ owned: false });

  await assert.rejects(
    () => transitionTicket(admin, ticket.id, { to: 'ready_qa', revision: 0 }),
    (err) => err.statusCode === 400 && err.code === 'OWNERSHIP_REQUIRED',
  );

  const { ticket: moved } = await transitionTicket(admin, ticket.id, {
    to: 'ready_local', revision: 0,
  });
  assert.equal(moved.status, 'ready_local');
});

test('an illegal transition is a 400 carrying the reason from canTransition', async () => {
  const { dev, ticket } = await seed();

  await assert.rejects(
    () => transitionTicket(dev, ticket.id, { to: 'qa_approved', revision: 0 }),
    (err) => err.statusCode === 400
      && err.code === 'STAGE_NOT_PERMITTED'
      && /lacks qa approve/i.test(err.message),
  );
});

test('a stale revision loses the compare-and-set with 409', async () => {
  const { admin, ticket } = await seed();
  await transitionTicket(admin, ticket.id, { to: 'under_review', revision: 0 });

  await assert.rejects(
    () => transitionTicket(admin, ticket.id, { to: 'in_progress', revision: 0 }),
    (err) => err.statusCode === 409
      && err.code === 'STAGE_CONFLICT'
      && err.fields.currentStatus === 'under_review'
      && err.fields.currentRevision === 1,
  );
});

test('two concurrent transitions produce one winner and one 409', async () => {
  const { admin, ticket } = await seed();

  const settled = await Promise.allSettled([
    transitionTicket(admin, ticket.id, { to: 'under_review', revision: 0 }),
    transitionTicket(admin, ticket.id, { to: 'in_progress', revision: 0 }),
  ]);

  assert.equal(settled.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(settled.find((r) => r.status === 'rejected').reason.statusCode, 409);

  const stored = await reload(ticket.id);
  assert.equal(stored.stageHistory.length, 2, 'exactly one transition was appended');
  assert.equal(stored.revision, 1);
});

test('a replayed transition request is a clean 409, not a second history entry', async () => {
  const { admin, ticket } = await seed();
  const payload = { to: 'under_review', revision: 0 };

  await transitionTicket(admin, ticket.id, payload);
  await assert.rejects(
    () => transitionTicket(admin, ticket.id, payload),
    (err) => err.statusCode === 409,
  );

  assert.equal((await reload(ticket.id)).stageHistory.length, 2);
});

test('Reopen requires a note, increments reopenCount and records the origin', async () => {
  const { admin, ticket } = await seed();
  const atQa = await transitionTicket(admin, ticket.id, { to: 'ready_qa', revision: 0 });

  await assert.rejects(
    () => transitionTicket(admin, ticket.id, {
      to: 'in_progress', revision: atQa.ticket.revision,
    }),
    (err) => err.statusCode === 400 && err.code === 'NOTE_REQUIRED',
  );

  const { ticket: reopened, event } = await transitionTicket(admin, ticket.id, {
    to: 'in_progress', revision: atQa.ticket.revision, note: 'Login still fails on Safari',
  });

  assert.equal(reopened.status, 'in_progress');
  assert.equal(reopened.reopenCount, 1);
  assert.ok(reopened.reopenedAt);
  assert.equal(event.type, 'TICKET_REOPENED');

  const entry = (await reload(ticket.id)).stageHistory.at(-1);
  assert.equal(entry.from, 'ready_qa');
  assert.equal(entry.decision, 'rejected');
  assert.equal(entry.note, 'Login still fails on Safari');
});

test('a QA rejection files its report attachments on the stage entry', async () => {
  const { admin, ticket } = await seed();
  const atQa = await transitionTicket(admin, ticket.id, { to: 'ready_qa', revision: 0 });

  // Stands in for the /attachments upload the UI does first.
  const shot = { key: 'tickets/shot.png', name: 'shot.png', size: 120, mimeType: 'image/png', uploadedBy: admin._id };
  await Ticket.updateOne({ _id: ticket.id }, { $push: { attachments: shot } });
  const uploaded = (await reload(ticket.id)).attachments.at(-1);

  const { ticket: rejected } = await transitionTicket(admin, ticket.id, {
    to: 'in_progress',
    revision: atQa.ticket.revision,
    note: 'Login still fails on Safari',
    attachmentIds: [String(uploaded._id)],
  });

  assert.equal(rejected.status, 'in_progress');

  const entry = (await reload(ticket.id)).stageHistory.at(-1);
  assert.equal(entry.decision, 'rejected');
  assert.equal(entry.attachments.length, 1);
  assert.equal(entry.attachments[0].name, 'shot.png');
  assert.equal(String(entry.attachments[0]._id), String(uploaded._id));
});

test('a report attachment that is not on this ticket is refused', async () => {
  const { admin, ticket } = await seed();
  const atQa = await transitionTicket(admin, ticket.id, { to: 'ready_qa', revision: 0 });

  await assert.rejects(
    () => transitionTicket(admin, ticket.id, {
      to: 'in_progress',
      revision: atQa.ticket.revision,
      note: 'Login still fails on Safari',
      attachmentIds: ['507f1f77bcf86cd799439011'],
    }),
    (err) => err.statusCode === 400 && err.code === 'ATTACHMENT_NOT_FOUND',
  );

  // Refused BEFORE the write: the ticket has not moved.
  assert.equal((await reload(ticket.id)).status, 'ready_qa');
});

test('closing early requires a reason and stores it on the document and the history', async () => {
  const { admin, ticket } = await seed();

  await assert.rejects(
    () => transitionTicket(admin, ticket.id, { to: 'closed', revision: 0 }),
    (err) => err.statusCode === 400 && err.code === 'REASON_REQUIRED',
  );

  const { ticket: closed, event } = await transitionTicket(admin, ticket.id, {
    to: 'closed', revision: 0, reason: 'Duplicate of WEB-7',
  });

  assert.equal(closed.status, 'closed');
  assert.equal(closed.closeReason, 'Duplicate of WEB-7');
  assert.ok(closed.closedAt);
  assert.equal(event.type, 'TICKET_CLOSED');
});

test('an assigned developer can close and reopen with reason and note', async () => {
  const { dev, ticket } = await seed();

  const { ticket: closed } = await transitionTicket(dev, ticket.id, {
    to: 'closed', revision: ticket.revision, reason: 'Fix verified in staging',
  });
  assert.equal(closed.status, 'closed');
  assert.equal(closed.closeReason, 'Fix verified in staging');

  const { ticket: reopened } = await transitionTicket(dev, ticket.id, {
    to: 'in_progress', revision: closed.revision, note: 'Regression reproduced in production',
  });
  assert.equal(reopened.status, 'in_progress');
  assert.equal(reopened.reopenCount, 1);
});

test('a mixed developer+client user follows internal lane rules when assigned', async () => {
  const admin = await user(ROLE_IDS.ADMIN);
  const hybrid = await User.create({
    name: 'hybrid',
    email: `${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-long-enough-password',
    status: 'active',
    role: ROLE_IDS.DEVELOPER,
    roles: [ROLE_IDS.DEVELOPER, ROLE_IDS.CLIENT],
  });
  const project = await Project.create({ key: 'MIX', name: 'Mixed', createdBy: admin._id });
  const created = await createTicket(admin, {
    project: project.id,
    title: 'Mixed-role transition',
    description: 'Internal board permissions should apply when an internal role is present.',
    assignedTo: hybrid._id,
  });
  await Ticket.updateOne({ _id: created.id }, {
    $set: { status: 'in_progress', estimatedResolutionAt: IN_A_WEEK, expectedReleaseDate: IN_A_WEEK },
  });

  const { ticket: moved } = await transitionTicket(hybrid, created.ticketId, {
    to: 'ready_qa', revision: created.revision,
  });
  assert.equal(moved.status, 'ready_qa');
});

test('a related support user is still blocked from closing', async () => {
  const { admin, ticket } = await seed();
  const support = await user(ROLE_IDS.SUPPORT);
  await Ticket.updateOne({ _id: ticket.id }, { $set: { assignedTo: support._id } });

  await assert.rejects(
    () => transitionTicket(support, ticket.id, {
      to: 'closed', revision: ticket.revision, reason: 'Trying to close without permission',
    }),
    (err) => err.statusCode === 400 && err.code === 'STAGE_NOT_PERMITTED',
  );

  const { ticket: closed } = await transitionTicket(admin, ticket.id, {
    to: 'closed', revision: ticket.revision, reason: 'Admin close',
  });
  assert.equal(closed.status, 'closed');
});

test('reopening a closed ticket clears the close fields and PRESERVES the close entry', async () => {
  const { admin, ticket } = await seed();
  const closed = await transitionTicket(admin, ticket.id, {
    to: 'closed', revision: 0, reason: 'Duplicate of WEB-7',
  });

  const { ticket: reopened } = await transitionTicket(admin, ticket.id, {
    to: 'in_progress', revision: closed.ticket.revision, note: 'Not a duplicate after all',
  });

  // The document holds current state...
  assert.equal(reopened.status, 'in_progress');
  assert.equal(reopened.closedAt, undefined);
  assert.equal(reopened.closedBy, undefined);
  assert.equal(reopened.closeReason, undefined);

  // ...stageHistory holds what happened. Both stay true.
  const history = (await reload(ticket.id)).stageHistory;
  const closeEntry = history.find((h) => h.to === 'closed');
  assert.ok(closeEntry, 'the original close survives');
  assert.equal(closeEntry.note, 'Duplicate of WEB-7');
  assert.equal(history.at(-1).from, 'closed');
});

test('the pipeline never writes resolvedAt or resolvedBy', async () => {
  const { admin, ticket } = await seed();
  const live = await transitionTicket(admin, ticket.id, { to: 'live', revision: 0 });

  assert.equal(live.ticket.resolvedAt, undefined);
  assert.equal(live.ticket.resolvedBy, undefined);
});

test('checkGuards is pure and reports which guard failed', () => {
  const bare = {
    estimatedResolutionAt: null, expectedReleaseDate: null, team: null, assignedTo: null,
  };

  assert.equal(checkGuards('under_review', bare).ok, true);
  assert.equal(checkGuards('in_progress', bare).code, 'ESTIMATES_REQUIRED');
  assert.equal(
    checkGuards('ready_qa', {
      ...bare, estimatedResolutionAt: new Date(), expectedReleaseDate: new Date(),
    }).code,
    'OWNERSHIP_REQUIRED',
  );
});

async function seedProjectWithQa() {
  const admin = await user(ROLE_IDS.ADMIN);
  const developer = await user(ROLE_IDS.DEVELOPER);
  const qa = await user(ROLE_IDS.TESTER);
  const outsiderQa = await user(ROLE_IDS.TESTER);
  const team = await Team.create({
    name: 'Web Team',
    members: [developer._id, qa._id],
    createdBy: admin._id,
  });
  const project = await Project.create({
    key: 'WEB',
    name: 'Web App',
    createdBy: admin._id,
    defaultTeam: team._id,
    defaultTester: qa._id,
  });
  await assignProjectTeam(project._id, team._id);
  return { admin, developer, qa, outsiderQa, team, project };
}

async function withEstimates(ticketId) {
  await Ticket.updateOne({ _id: ticketId }, {
    $set: { estimatedResolutionAt: IN_A_WEEK, expectedReleaseDate: IN_A_WEEK },
  });
}

test('transition to ready_qa auto-assigns testedBy from the project qa role', async () => {
  const { admin, developer, qa, project } = await seedProjectWithQa();
  const ticket = await createTicket(admin, {
    project: project._id,
    title: 'Checkout regression',
    assignedTo: developer._id,
    team: undefined,
  });
  await Ticket.updateOne({ _id: ticket.id }, { $unset: { testedBy: 1 } });
  await withEstimates(ticket.id);

  const { ticket: moved } = await transitionTicket(admin, ticket.id, {
    to: 'ready_qa',
    revision: ticket.revision,
  });

  assert.equal(String(moved.testedBy), String(qa._id));
  assert.equal((await getTicket(qa, moved.ticketId)).ticketId, moved.ticketId);
});

test('project qa can list the ticket after it enters ready_qa', async () => {
  const { admin, developer, qa, project } = await seedProjectWithQa();
  const ticket = await createTicket(admin, {
    project: project._id,
    title: 'Login failure',
    assignedTo: developer._id,
  });
  await Ticket.updateOne({ _id: ticket.id }, { $unset: { testedBy: 1 } });
  await withEstimates(ticket.id);
  await transitionTicket(admin, ticket.id, { to: 'ready_qa', revision: ticket.revision });

  const page = await listTickets(qa, { project: String(project._id) });
  assert.ok(page.results.some((row) => row.ticketId === ticket.ticketId));
});

test('qa from another project cannot view after ready_qa transition', async () => {
  const { admin, developer, outsiderQa, project } = await seedProjectWithQa();
  const ticket = await createTicket(admin, {
    project: project._id,
    title: 'Mobile-only bug',
    assignedTo: developer._id,
  });
  await Ticket.updateOne({ _id: ticket.id }, { $unset: { testedBy: 1 } });
  await withEstimates(ticket.id);
  const { ticket: moved } = await transitionTicket(admin, ticket.id, {
    to: 'ready_qa',
    revision: ticket.revision,
  });

  await assert.rejects(
    () => getTicket(outsiderQa, moved.ticketId),
    (err) => err.statusCode === 403 && err.code === 'FORBIDDEN',
  );
  assert.equal((await listTickets(outsiderQa, {})).totalResults, 0);
});

/**
 * Task 10's coercion-test fixture, reused: a Client-owned project, a
 * client_tester scoped to it via AccessAssignment, and a ticket whose
 * createdBy is reassigned to that tester so canExternalViewTicket's
 * creator-match rule is satisfied. Moved straight to `live` so the
 * client-closing-their-own-live-ticket bypass in assertMayTransition applies.
 */
async function seedExternalLiveTicket(admin, role = ROLE_IDS.CLIENT_TESTER, {
  accept = true,
} = {}) {
  const externalUser = await user(role);
  const company = await Client.create({
    name: `Co-${Math.random().toString(36).slice(2)}`, status: 'active', createdBy: admin._id,
  });
  const project = await Project.create({
    key: `EX${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    name: 'External', client: company._id, createdBy: admin._id,
  });
  await AccessAssignment.create({
    user: externalUser._id, role,
    client: company._id, project: project._id, status: 'active', grantedBy: admin._id,
  });
  const ticket = await createTicket(admin, {
    project: project.id, title: 'Client-raised ticket', assignedTo: admin._id,
  });
  await Ticket.updateOne({ _id: ticket.id }, { $set: { createdBy: externalUser._id } });
  await withEstimates(ticket.id);
  const live = await transitionTicket(admin, ticket.id, { to: 'live', revision: ticket.revision });
  return { externalUser, ticket: live.ticket, permCtx: externalAcceptCtx(role, { accept }) };
}

test('an external tester can close their own live ticket but not another tenant\'s', async () => {
  const admin = await user(ROLE_IDS.ADMIN);
  const { externalUser: tester, ticket: own, permCtx } = await seedExternalLiveTicket(admin);
  const { ticket: other } = await seedExternalLiveTicket(admin);

  const { ticket: closed } = await transitionTicket(tester, own.ticketId, {
    to: 'closed', revision: own.revision, reason: 'Resolved on my end',
  }, permCtx);
  assert.equal(closed.status, 'closed');

  await assert.rejects(
    () => transitionTicket(tester, other.ticketId, {
      to: 'closed', revision: other.revision, reason: 'Not mine to close',
    }, permCtx),
    (err) => err.statusCode === 403 && err.code === 'FORBIDDEN',
  );
});

test('an external client can close their own Live ticket, with a reason, but not reopen it', async () => {
  const admin = await user(ROLE_IDS.ADMIN);
  const { externalUser: client, ticket: own, permCtx } = await seedExternalLiveTicket(
    admin, ROLE_IDS.CLIENT,
  );

  await assert.rejects(
    () => transitionTicket(client, own.ticketId, { to: 'closed', revision: own.revision }, permCtx),
    (err) => err.statusCode === 400,
  );
  const { ticket: closed } = await transitionTicket(client, own.ticketId, {
    to: 'closed', revision: own.revision, reason: 'Accepted as complete',
  }, permCtx);
  assert.equal(closed.status, 'closed');

  await assert.rejects(
    () => transitionTicket(client, own.ticketId, {
      to: 'in_progress', revision: closed.revision, note: 'Issue returned after retest',
    }, permCtx),
    (err) => err.statusCode === 403 && /only move Live tickets to Closed/.test(err.message),
  );
});

test('an external client remains blocked from unsupported stage moves', async () => {
  const admin = await user(ROLE_IDS.ADMIN);
  const { externalUser: client, ticket: own } = await seedExternalLiveTicket(admin, ROLE_IDS.CLIENT);

  await assert.rejects(
    () => transitionTicket(client, own.ticketId, {
      to: 'ready_production', revision: own.revision,
    }),
    (err) => err.statusCode === 403 && err.code === 'FORBIDDEN',
  );
});

test('the transition response ticket is sanitized when returned to an external actor', async () => {
  const admin = await user(ROLE_IDS.ADMIN);
  const { externalUser: tester, ticket: own, permCtx } = await seedExternalLiveTicket(admin);

  await addComment(admin, own.ticketId, { content: 'Internal review notes', internal: true });
  await addComment(admin, own.ticketId, { content: 'Public update' });

  const { ticket: closed } = await transitionTicket(tester, own.ticketId, {
    to: 'closed', revision: own.revision, reason: 'Resolved on my end',
  }, permCtx);

  assert.equal(closed.status, 'closed');

  assert.ok(
    closed.comments.some((c) => c.content === 'Public update'),
    'the public comment survives sanitization',
  );
  assert.ok(
    closed.comments.every((c) => c.content !== 'Internal review notes' && c.internal !== true),
    'no internal comment reaches an external actor',
  );

  assert.ok(closed.stageHistory.length > 0);
  for (const entry of closed.stageHistory) {
    assert.equal(Object.hasOwn(entry, 'note'), false, 'stageHistory entries carry no note for external actors');
    assert.equal(Object.hasOwn(entry, 'decision'), false, 'stageHistory entries carry no decision for external actors');
  }

  assert.ok(closed.activityLog.length > 0);
  assert.ok(
    closed.activityLog.every((entry) => entry.action === 'created'),
    'activityLog is limited to the client-visible "created" action',
  );
});

test('an external user without tickets.accept cannot close a visible live ticket', async () => {
  const admin = await user(ROLE_IDS.ADMIN);
  const { externalUser: client, ticket: own, permCtx } = await seedExternalLiveTicket(
    admin, ROLE_IDS.CLIENT, { accept: false },
  );

  await assert.rejects(
    () => transitionTicket(client, own.ticketId, {
      to: 'closed', revision: own.revision, reason: 'Should be denied',
    }, permCtx),
    (err) => err.statusCode === 403
      && err.code === 'FORBIDDEN'
      && /cannot close or reopen/i.test(err.message),
  );
});

test('an external client_tester can close, but not reopen, with tickets.accept', async () => {
  const admin = await user(ROLE_IDS.ADMIN);
  const { externalUser: tester, ticket: own, permCtx } = await seedExternalLiveTicket(admin);

  const { ticket: closed } = await transitionTicket(tester, own.ticketId, {
    to: 'closed', revision: own.revision, reason: 'Verified on staging',
  }, permCtx);
  assert.equal(closed.status, 'closed');

  await assert.rejects(
    () => transitionTicket(tester, own.ticketId, {
      to: 'in_progress', revision: closed.revision, note: 'Regression found during UAT',
    }, permCtx),
    (err) => err.statusCode === 403,
  );
});

test('an external user with tickets.accept is still limited to live→closed', async () => {
  const admin = await user(ROLE_IDS.ADMIN);
  const externalUser = await user(ROLE_IDS.CLIENT);
  const company = await Client.create({
    name: `Co-${Math.random().toString(36).slice(2)}`, status: 'active', createdBy: admin._id,
  });
  const project = await Project.create({
    key: `EX${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    name: 'External', client: company._id, createdBy: admin._id,
  });
  await AccessAssignment.create({
    user: externalUser._id, role: ROLE_IDS.CLIENT,
    client: company._id, project: project._id, status: 'active', grantedBy: admin._id,
  });
  const ticket = await createTicket(admin, {
    project: project.id, title: 'Still in dev', assignedTo: admin._id,
  });
  await withEstimates(ticket.id);
  await Ticket.updateOne({ _id: ticket.id }, { $set: { status: 'in_progress' } });

  const permCtx = externalAcceptCtx(ROLE_IDS.CLIENT);

  await assert.rejects(
    () => transitionTicket(externalUser, ticket.ticketId, {
      to: 'ready_qa', revision: ticket.revision,
    }, permCtx),
    (err) => err.statusCode === 403
      && err.code === 'FORBIDDEN'
      && /only move live tickets to closed/i.test(err.message),
  );
});

test('an external user cannot close a live ticket outside their assignment scope', async () => {
  const admin = await user(ROLE_IDS.ADMIN);
  const {
    externalUser: scopedTester, ticket: inScope, permCtx: scopedCtx,
  } = await seedExternalLiveTicket(admin);
  const { ticket: outOfScope } = await seedExternalLiveTicket(admin);

  await assert.rejects(
    () => transitionTicket(scopedTester, outOfScope.ticketId, {
      to: 'closed', revision: outOfScope.revision, reason: 'Out of scope',
    }, scopedCtx),
    (err) => err.statusCode === 403 && err.code === 'FORBIDDEN',
  );

  const { ticket: closed } = await transitionTicket(scopedTester, inScope.ticketId, {
    to: 'closed', revision: inScope.revision, reason: 'In scope',
  }, scopedCtx);
  assert.equal(closed.status, 'closed');
});
