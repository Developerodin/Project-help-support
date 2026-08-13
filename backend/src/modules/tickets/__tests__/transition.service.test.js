import test from 'node:test';
import assert from 'node:assert/strict';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import Ticket from '../ticket.model.js';
import { createTicket } from '../ticket.service.js';
import { transitionTicket, checkGuards } from '../transition.service.js';

withMemoryDb();

const IN_A_WEEK = new Date(Date.now() + 7 * 86400000);

const user = (role = 'member') => User.create({
  name: role, email: `${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password', status: 'active', role,
});

async function seed({ estimates = true, owned = true } = {}) {
  const admin = await user('admin');
  const dev = await user('developer');
  const web = await Project.create({ key: 'WEB', name: 'Web App', createdBy: admin._id });

  const ticket = await createTicket(admin, {
    project: web.id,
    title: 'Broken login',
    ...(estimates ? { estimatedResolutionAt: IN_A_WEEK, expectedReleaseDate: IN_A_WEEK } : {}),
    ...(owned ? { assignedTo: dev._id } : {}),
  });

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
      && /may not move/.test(err.message),
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
