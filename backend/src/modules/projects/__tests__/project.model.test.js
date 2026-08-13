import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import Project from '../project.model.js';

withMemoryDb();

const owner = () => new mongoose.Types.ObjectId();

const make = (over = {}) => Project.create({
  key: 'WEB', name: 'Web App', createdBy: owner(), ...over,
});

test('a new project starts its counter at 1', async () => {
  const project = await make();
  assert.equal(project.nextTicketSeq, 1);
  assert.equal(project.status, 'active');
});

test('key is uppercased and must be unique', async () => {
  await make({ key: 'web' });
  const stored = await Project.findOne({});
  assert.equal(stored.key, 'WEB');

  await Project.init();
  await assert.rejects(() => make({ key: 'WEB' }), (err) => err.code === 11000);
});

test('key is rejected when it does not look like a ticket prefix', async () => {
  await assert.rejects(() => make({ key: 'W' }));
  await assert.rejects(() => make({ key: 'WEB-APP' }));
});

test('key cannot be changed after creation', async () => {
  const project = await make();

  project.key = 'MOB';
  await project.save();
  assert.equal((await Project.findById(project._id)).key, 'WEB');

  await Project.updateOne({ _id: project._id }, { $set: { key: 'MOB' } });
  assert.equal((await Project.findById(project._id)).key, 'WEB');
});

test('allocateTicketSeq returns the pre-increment value and advances the counter', async () => {
  const project = await make();

  const first = await Project.allocateTicketSeq(project._id);
  assert.deepEqual(first, { key: 'WEB', seq: 1 });

  const second = await Project.allocateTicketSeq(project._id);
  assert.equal(second.seq, 2);
  assert.equal((await Project.findById(project._id)).nextTicketSeq, 3);
});

test('50 concurrent allocations produce 50 distinct sequence numbers', async () => {
  const project = await make();

  const results = await Promise.all(
    Array.from({ length: 50 }, () => Project.allocateTicketSeq(project._id)),
  );
  const seqs = results.map((r) => r.seq).sort((a, b) => a - b);

  assert.equal(new Set(seqs).size, 50, 'every allocation must be unique');
  assert.deepEqual(seqs, Array.from({ length: 50 }, (_, i) => i + 1));
});

test('allocating against a missing project throws 404', async () => {
  await assert.rejects(
    () => Project.allocateTicketSeq(new mongoose.Types.ObjectId()),
    (err) => err.statusCode === 404 && err.code === 'PROJECT_NOT_FOUND',
  );
});
