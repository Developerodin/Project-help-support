import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS } from '@pms/shared';
import mongoose from 'mongoose';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import Project from '../../projects/project.model.js';
import Ticket from '../ticket.model.js';
import { median, percentile, stageDurations, timeInStage } from '../analytics.service.js';

withMemoryDb();

const actor = { _id: new mongoose.Types.ObjectId(), role: ROLE_IDS.DEVELOPER };
const HOUR = 3600000;
const at = (hours) => new Date(Date.UTC(2026, 0, 1) + hours * HOUR);

test('median handles odd and even lengths, and an empty list', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
  assert.equal(median([7]), 7);
});

test('p90 is nearest-rank, which is the definition the UI labels', () => {
  // 10 values: ceil(0.9 * 10) = 9 -> the 9th smallest.
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9);
  // 5 values: ceil(0.9 * 5) = 5 -> the largest.
  assert.equal(percentile([10, 20, 30, 40, 50], 0.9), 50);
  assert.equal(percentile([], 0.9), null);
});

test('stageDurations measures each CLOSED interval between consecutive entries', () => {
  const history = [
    { to: 'pending', at: at(0) },
    { to: 'under_review', at: at(2) },   // pending lasted 2h
    { to: 'in_progress', at: at(5) },    // under_review lasted 3h
    { to: 'live', at: at(11) },          // in_progress lasted 6h
  ];

  assert.deepEqual(stageDurations(history), [
    { stage: 'pending', ms: 2 * HOUR },
    { stage: 'under_review', ms: 3 * HOUR },
    { stage: 'in_progress', ms: 6 * HOUR },
  ]);
});

test('the CURRENT stage is open-ended and is excluded, not counted as zero', () => {
  const history = [{ to: 'pending', at: at(0) }, { to: 'in_progress', at: at(4) }];
  assert.deepEqual(stageDurations(history).map((d) => d.stage), ['pending']);
});

test('a skipped stage is never entered, so it contributes no duration', () => {
  // pending -> live directly: nothing in between was ever entered.
  assert.deepEqual(
    stageDurations([{ to: 'pending', at: at(0) }, { to: 'live', at: at(9) }]),
    [{ stage: 'pending', ms: 9 * HOUR }],
  );
});

test('a stage entered twice contributes twice', () => {
  const history = [
    { to: 'pending', at: at(0) },
    { to: 'in_progress', at: at(1) },
    { to: 'ready_qa', at: at(3) },      // in_progress: 2h
    { to: 'in_progress', at: at(6) },   // ready_qa: 3h  (a Reopen)
    { to: 'live', at: at(10) },         // in_progress: 4h
  ];

  const inProgress = stageDurations(history).filter((d) => d.stage === 'in_progress');
  assert.deepEqual(inProgress.map((d) => d.ms / HOUR), [2, 4]);
});

test('timeInStage reports the median and p90 in hours per stage', async () => {
  const project = await Project.create({ key: 'WEB', name: 'Web App', createdBy: actor._id });

  // Three tickets whose `pending` durations are 1h, 3h and 20h.
  await Ticket.insertMany([1, 3, 20].map((hours, i) => ({
    ticketId: `WEB-${i + 1}`,
    project: project._id,
    title: `Ticket ${i + 1}`,
    createdBy: actor._id,
    status: 'in_progress',
    stageHistory: [
      { to: 'pending', by: actor._id, at: at(0) },
      { to: 'in_progress', by: actor._id, at: at(hours) },
    ],
  })));

  const result = await timeInStage(actor, {});

  assert.equal(result.byStage.pending.count, 3);
  assert.equal(result.byStage.pending.medianHours, 3);
  // ceil(0.9 * 3) = 3 -> the largest sample.
  assert.equal(result.byStage.pending.p90Hours, 20);

  // in_progress is the CURRENT stage on every ticket, so it has no closed sample.
  assert.equal(result.byStage.in_progress.count, 0);
  assert.equal(result.byStage.in_progress.medianHours, null);
});

test('the bottleneck is the stage with the largest median', async () => {
  const project = await Project.create({ key: 'WEB', name: 'Web App', createdBy: actor._id });
  await Ticket.create({
    ticketId: 'WEB-1', project: project._id, title: 'x', createdBy: actor._id, status: 'live',
    stageHistory: [
      { to: 'pending', by: actor._id, at: at(0) },
      { to: 'in_progress', by: actor._id, at: at(1) },   // pending 1h
      { to: 'ready_qa', by: actor._id, at: at(50) },     // in_progress 49h
      { to: 'live', by: actor._id, at: at(52) },         // ready_qa 2h
    ],
  });

  assert.equal((await timeInStage(actor, {})).bottleneck, 'in_progress');
});
