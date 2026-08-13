import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { withMemoryDb } from './helpers/memoryDb.js';
import { paginate } from '../paginate.js';

withMemoryDb();

const Item = mongoose.model('PaginateItem', new mongoose.Schema({
  name: String, rank: Number, group: String,
}, { timestamps: true }));

async function seed(count = 25) {
  await Item.insertMany(
    Array.from({ length: count }, (_, i) => ({
      name: `item-${String(i).padStart(2, '0')}`,
      rank: i,
      group: i % 2 === 0 ? 'even' : 'odd',
    })),
  );
}

test('returns the first page with correct totals', async () => {
  await seed();
  const res = await paginate(Item, {}, { page: 1, limit: 10, sortBy: 'rank:asc' });
  assert.equal(res.results.length, 10);
  assert.equal(res.page, 1);
  assert.equal(res.limit, 10);
  assert.equal(res.totalResults, 25);
  assert.equal(res.totalPages, 3);
  assert.equal(res.results[0].rank, 0);
});

test('honours the filter in both results and totals', async () => {
  await seed();
  const res = await paginate(Item, { group: 'even' }, { page: 1, limit: 100 });
  assert.equal(res.totalResults, 13);
  assert.ok(res.results.every((r) => r.group === 'even'));
});

test('sorts descending and supports multiple keys', async () => {
  await seed();
  const res = await paginate(Item, {}, { page: 1, limit: 3, sortBy: 'group:asc,rank:desc' });
  assert.equal(res.results[0].group, 'even');
  assert.equal(res.results[0].rank, 24);
});

test('a page beyond the end returns empty results, not an error', async () => {
  await seed();
  const res = await paginate(Item, {}, { page: 99, limit: 10 });
  assert.deepEqual(res.results, []);
  assert.equal(res.totalResults, 25);
});

test('clamps limit to a maximum so a caller cannot request the whole collection', async () => {
  await seed(120);
  const res = await paginate(Item, {}, { page: 1, limit: 10000 });
  assert.equal(res.limit, 100);
  assert.equal(res.results.length, 100);
});
