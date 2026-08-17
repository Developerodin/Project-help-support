import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS } from '@pms/shared';
import mongoose from 'mongoose';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import Project from '../../projects/project.model.js';
import Ticket from '../ticket.model.js';
import { overview } from '../analytics.service.js';

withMemoryDb();

const actor = { _id: new mongoose.Types.ObjectId(), role: ROLE_IDS.DEVELOPER };

async function seed(rows) {
  const project = await Project.create({ key: 'WEB', name: 'Web App', createdBy: actor._id });

  if (rows.length) {
    await Ticket.insertMany(rows.map((row, i) => ({
      ticketId: `WEB-${i + 1}`,
      project: project._id,
      title: `Ticket ${i + 1}`,
      createdBy: actor._id,
      ...row,
    })));
  }

  return project;
}

test('every ticket lands in exactly one lane, and the lanes sum to the total', async () => {
  await seed([
    { status: 'pending' }, { status: 'under_review' },
    { status: 'in_progress' }, { status: 'ready_local' },
    { status: 'ready_qa' }, { status: 'deployed_staging' }, { status: 'qa_approved' },
    { status: 'ready_production' }, { status: 'live' },
    { status: 'closed' },
  ]);

  const result = await overview(actor, {});

  assert.equal(result.total, 10);
  assert.deepEqual(result.lanes, { intake: 2, development: 2, qa: 3, release: 2, done: 1 });

  const summed = Object.values(result.lanes).reduce((a, b) => a + b, 0);
  assert.equal(summed, result.total, 'the tiles must sum to the filtered total');
});

test('byStage reports all ten stages, including the empty ones', async () => {
  await seed([{ status: 'pending' }, { status: 'pending' }]);

  const result = await overview(actor, {});

  assert.equal(Object.keys(result.byStage).length, 10);
  assert.equal(result.byStage.pending, 2);
  assert.equal(result.byStage.qa_approved, 0);
});

test('blockerCritical counts Critical or Blocker severity, once each', async () => {
  await seed([
    { status: 'pending', severity: 'Critical' },
    { status: 'in_progress', severity: 'Blocker' },
    { status: 'live', severity: 'Critical', labels: ['regression'] },
    { status: 'pending', severity: 'Minor' },
  ]);

  const result = await overview(actor, {});

  assert.equal(result.blockerCritical, 3);
  // It deliberately OVERLAPS the lane tiles, so it is not part of the sum.
  assert.equal(Object.values(result.lanes).reduce((a, b) => a + b, 0), 4);
});

test('the same filters as the ticket list apply, and the sum still holds', async () => {
  const project = await seed([
    { status: 'pending', severity: 'Critical' },
    { status: 'live', severity: 'Minor' },
  ]);

  const filtered = await overview(actor, {
    project: String(project._id), severity: 'Critical',
  });

  assert.equal(filtered.total, 1);
  assert.equal(filtered.lanes.intake, 1);
  assert.equal(Object.values(filtered.lanes).reduce((a, b) => a + b, 0), 1);
});

test('an empty result set reports zeroes rather than undefined', async () => {
  await seed([]);
  const result = await overview(actor, {});

  assert.equal(result.total, 0);
  assert.deepEqual(result.lanes, { intake: 0, development: 0, qa: 0, release: 0, done: 0 });
  assert.equal(result.blockerCritical, 0);
});
