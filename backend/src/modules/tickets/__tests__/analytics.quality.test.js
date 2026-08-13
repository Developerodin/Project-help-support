import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import Project from '../../projects/project.model.js';
import Ticket from '../ticket.model.js';
import { estimateAccuracy, reopenAfterQa, aging, trend, drill } from '../analytics.service.js';

withMemoryDb();

const actor = { _id: new mongoose.Types.ObjectId(), role: 'member' };
const DAY = 86400000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);

const project = () => Project.create({ key: 'WEB', name: 'Web App', createdBy: actor._id });
const row = (i, over = {}) => ({
  ticketId: `WEB-${i}`, title: `Ticket ${i}`, createdBy: actor._id, ...over,
});

test('estimate variance buckets a live ticket as early, on time or late', async () => {
  const web = await project();
  const estimate = new Date(Date.UTC(2026, 5, 10));

  await Ticket.insertMany([
    // Shipped two days early.
    row(1, {
      project: web._id, status: 'live', estimatedResolutionAt: estimate,
      stageHistory: [{ to: 'live', by: actor._id, at: new Date(Date.UTC(2026, 5, 8)) }],
    }),
    // Shipped on the estimated day.
    row(2, {
      project: web._id, status: 'live', estimatedResolutionAt: estimate,
      stageHistory: [{ to: 'live', by: actor._id, at: estimate }],
    }),
    // Shipped five days late.
    row(3, {
      project: web._id, status: 'live', estimatedResolutionAt: estimate,
      stageHistory: [{ to: 'live', by: actor._id, at: new Date(Date.UTC(2026, 5, 15)) }],
    }),
    // Never reached live — not measurable, and must NOT be counted as on time.
    row(4, {
      project: web._id, status: 'in_progress', estimatedResolutionAt: estimate, stageHistory: [],
    }),
    // Reached live but was never estimated — also not measurable.
    row(5, {
      project: web._id, status: 'live',
      stageHistory: [{ to: 'live', by: actor._id, at: estimate }],
    }),
  ]);

  const result = await estimateAccuracy(actor, {});

  assert.equal(result.measured, 3);
  assert.equal(result.early, 1);
  assert.equal(result.onTime, 1);
  assert.equal(result.late, 1);
});

test('on time is judged by calendar day, not by millisecond', async () => {
  const web = await project();
  await Ticket.create(row(1, {
    project: web._id, status: 'live',
    estimatedResolutionAt: new Date(Date.UTC(2026, 5, 10, 9, 0)),
    stageHistory: [{ to: 'live', by: actor._id, at: new Date(Date.UTC(2026, 5, 10, 17, 30)) }],
  }));

  assert.equal((await estimateAccuracy(actor, {})).onTime, 1);
});

test('reopen-after-QA counts reopens whose ORIGIN was ready_qa or later', async () => {
  const web = await project();

  await Ticket.insertMany([
    // Reached QA, reopened out of deployed_staging -> numerator and denominator.
    row(1, {
      project: web._id, status: 'in_progress',
      stageHistory: [
        { to: 'ready_qa', by: actor._id, at: daysAgo(5) },
        { to: 'deployed_staging', by: actor._id, at: daysAgo(4) },
        { from: 'deployed_staging', to: 'in_progress', by: actor._id, at: daysAgo(3) },
      ],
    }),
    // Reached QA, never reopened -> denominator only.
    row(2, {
      project: web._id, status: 'live',
      stageHistory: [
        { to: 'ready_qa', by: actor._id, at: daysAgo(5) },
        { to: 'live', by: actor._id, at: daysAgo(1) },
      ],
    }),
    // Never reached QA -> in neither.
    row(3, {
      project: web._id, status: 'in_progress',
      stageHistory: [{ to: 'in_progress', by: actor._id, at: daysAgo(2) }],
    }),
  ]);

  const result = await reopenAfterQa(actor, {});

  assert.equal(result.reachedQa, 2);
  assert.equal(result.reopenedAfterQa, 1);
  assert.equal(result.rate, 0.5);
});

test('reopen-after-QA reports a null rate rather than dividing by zero', async () => {
  await project();
  const result = await reopenAfterQa(actor, {});

  assert.equal(result.reachedQa, 0);
  assert.equal(result.rate, null);
});

test('aging buckets OPEN tickets by age and ignores closed ones', async () => {
  const web = await project();

  await Ticket.insertMany([
    row(1, { project: web._id, status: 'pending', createdAt: daysAgo(0) }),
    row(2, { project: web._id, status: 'in_progress', createdAt: daysAgo(3) }),
    row(3, { project: web._id, status: 'ready_qa', createdAt: daysAgo(20) }),
    row(4, { project: web._id, status: 'live', createdAt: daysAgo(60) }),
    // Closed tickets are not "aging" — they are done.
    row(5, { project: web._id, status: 'closed', createdAt: daysAgo(90) }),
  ], { timestamps: false });

  const result = await aging(actor, {});

  assert.deepEqual(result.buckets, { '0-1': 1, '2-7': 1, '8-30': 1, '31+': 1 });
});

test('trend groups by day and reports created and closed per bucket', async () => {
  const web = await project();

  await Ticket.insertMany([
    row(1, { project: web._id, status: 'pending', createdAt: daysAgo(1) }),
    row(2, { project: web._id, status: 'pending', createdAt: daysAgo(1) }),
    row(3, { project: web._id, status: 'closed', createdAt: daysAgo(2), closedAt: daysAgo(1) }),
  ], { timestamps: false });

  const result = await trend(actor, { groupBy: 'day' });
  const yesterday = daysAgo(1).toISOString().slice(0, 10);
  const point = result.points.find((p) => p.bucket === yesterday);

  assert.equal(point.created, 2);
  assert.equal(point.closed, 1);
});

test('drill counts by dimension and names the empty case explicitly', async () => {
  const web = await project();

  await Ticket.insertMany([
    row(1, { project: web._id, status: 'pending', module: 'ATS', severity: 'Critical' }),
    row(2, { project: web._id, status: 'pending', module: 'ATS', severity: 'Minor' }),
    row(3, { project: web._id, status: 'pending', severity: 'Minor' }),
  ]);

  const byModule = await drill(actor, { dimension: 'module' });
  assert.deepEqual(byModule.rows, [
    { key: 'ATS', count: 2 },
    { key: 'Unspecified', count: 1 },
  ]);

  const bySeverity = await drill(actor, { dimension: 'severity' });
  assert.deepEqual(bySeverity.rows, [
    { key: 'Minor', count: 2 },
    { key: 'Critical', count: 1 },
  ]);
});
