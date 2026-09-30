import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import logger from '../../../platform/logger.js';
import { MongoRateLimitStore } from '../../../platform/rateLimit.js';
import {
  AssistantLock, AssistantUsage, checkAllowance, costUsd, estimateAudioSeconds, getAllowance, recordUsage, withChatLock,
} from '../assistant.guard.js';

withMemoryDb();

// Round numbers: ₹100 a day at ₹100 to the dollar is a $1 allowance.
const config = {
  assistant: {
    userDailyBudgetInr: 100,
    usdToInr: 100,
    budgetTimeZone: 'Asia/Kolkata',
    monthlyTokenBudget: 3_000_000,
    prices: {
      chatInputPerM: 1, chatOutputPerM: 1, transcribePerMin: 0.06, speechPerMin: 0.09,
    },
  },
};
const ada = { _id: new mongoose.Types.ObjectId() };
const bo = { _id: new mongoose.Types.ObjectId() };
const noon = new Date('2026-09-23T06:30:00Z'); // 12:00 IST

test('costs each kind of call from what it used', () => {
  const { prices } = config.assistant;
  assert.equal(costUsd(prices, { inputTokens: 1_000_000 }), 1);
  assert.equal(costUsd(prices, { outputTokens: 500_000 }), 0.5);
  assert.equal(costUsd(prices, { transcribeSeconds: 60 }), 0.06);
  assert.equal(costUsd(prices, { speechChars: 900 }), 0.09);
  assert.equal(estimateAudioSeconds(20_000), 10);
  assert.equal(estimateAudioSeconds(5_000_000), 60, 'never more than the 60s recording cap');
  assert.equal(estimateAudioSeconds(10), 1);
});

test('a user may spend today’s ₹ allowance, then is refused; other users are unaffected', async () => {
  await checkAllowance(config, ada, noon);
  await recordUsage(config, ada, { inputTokens: 600_000, outputTokens: 300_000 }, noon); // $0.90
  await checkAllowance(config, ada, noon);
  await recordUsage(config, ada, { transcribeSeconds: 120, speechChars: 900 }, noon); // +$0.21
  await assert.rejects(
    checkAllowance(config, ada, noon),
    (err) => err.statusCode === 429 && err.code === 'ASSISTANT_DAILY_LIMIT' && /₹100/.test(err.message),
  );
  await checkAllowance(config, bo, noon);
  const day = await AssistantUsage.findById(`user:${ada._id}:2026-09-23`).lean();
  assert.equal(day.costMicros, 1_110_000);
  assert.equal(day.tokens, 900_000);
});

test('the allowance resets at midnight India time, not UTC', async () => {
  const lateEvening = new Date('2026-09-23T18:29:00Z'); // 23:59 IST on the 23rd
  const justAfterMidnight = new Date('2026-09-23T18:31:00Z'); // 00:01 IST on the 24th
  await recordUsage(config, ada, { inputTokens: 1_000_000 }, lateEvening);
  await assert.rejects(checkAllowance(config, ada, lateEvening), (err) => err.code === 'ASSISTANT_DAILY_LIMIT');
  await checkAllowance(config, ada, justAfterMidnight);
});

test('the usage meter reports spend against the rupee limit and the next IST midnight', async () => {
  const at = new Date('2026-09-23T20:00:00Z'); // 01:30 IST on the 24th
  assert.deepEqual(await getAllowance(config, ada, at), {
    limitInr: 100, usedInr: 0, percent: 0, resetsAt: '2026-09-24T18:30:00.000Z',
  });
  await recordUsage(config, ada, { inputTokens: 290_000 }, at); // $0.29 = ₹29
  const usage = await getAllowance(config, ada, at);
  assert.equal(usage.percent, 29);
  assert.equal(usage.usedInr, 29);
  await recordUsage(config, ada, { inputTokens: 2_000_000 }, at);
  assert.equal((await getAllowance(config, ada, at)).percent, 100, 'capped at 100%');
  const requestsBefore = (await AssistantUsage.findById(`user:${ada._id}:2026-09-24`).lean()).requests;
  assert.equal(requestsBefore, 0, 'reading the meter never counts as a request');
});

test('the workspace pauses once the monthly token budget is spent, and warns once at 80%', async (t) => {
  const warn = t.mock.method(logger, 'warn', () => {});
  await recordUsage(config, ada, { inputTokens: 2_000_000 }, noon);
  assert.equal(warn.mock.callCount(), 0);
  await recordUsage(config, bo, { inputTokens: 500_000 }, noon); // 2.5M = 83%
  await recordUsage(config, bo, { inputTokens: 100_000 }, noon);
  assert.equal(warn.mock.callCount(), 1);
  await recordUsage(config, bo, { inputTokens: 500_000 }, noon); // over budget
  await assert.rejects(checkAllowance(config, bo, noon), (err) => err.statusCode === 503 && err.code === 'ASSISTANT_BUDGET_EXHAUSTED');
  await checkAllowance(config, bo, new Date('2026-10-01T06:30:00Z'));
});

test('one chat turn at a time per user; the lock is released after, even on failure', async () => {
  let release;
  const first = withChatLock(ada, () => new Promise((resolve) => { release = resolve; }));
  await new Promise((resolve) => { setTimeout(resolve, 20); });
  await assert.rejects(withChatLock(ada, async () => 'second', { waitMs: 0 }), (err) => err.statusCode === 409 && err.code === 'ASSISTANT_BUSY');
  assert.equal(await withChatLock(bo, async () => 'other user'), 'other user');
  release('first');
  assert.equal(await first, 'first');

  await assert.rejects(withChatLock(ada, async () => { throw new Error('boom'); }), /boom/);
  assert.equal(await withChatLock(ada, async () => 'after failure'), 'after failure');
});

test('a lock left by a crashed process expires instead of blocking the user forever', async () => {
  await AssistantLock.create({ _id: String(ada._id), expiresAt: new Date(noon.getTime() - 1000) });
  assert.equal(await withChatLock(ada, async () => 'recovered', { now: noon }), 'recovered');
});

test('the Mongo rate-limit store shares one window per key and starts a new one when it passes', async () => {
  const store = new MongoRateLimitStore('test');
  store.init({ windowMs: 60_000 });
  const other = new MongoRateLimitStore('other');
  other.init({ windowMs: 60_000 });

  assert.equal((await store.increment('user:1')).totalHits, 1);
  const second = await store.increment('user:1');
  assert.equal(second.totalHits, 2);
  assert.ok(second.resetTime > new Date());
  assert.equal((await other.increment('user:1')).totalHits, 1, 'prefixes keep limiters apart');

  await mongoose.connection.collection('ratelimithits').updateOne({ _id: 'test:user:1' }, { $set: { resetAt: new Date(Date.now() - 1) } });
  assert.equal((await store.increment('user:1')).totalHits, 1, 'expired window restarts');
  await store.decrement('user:1');
  await store.resetKey('user:1');
  assert.equal((await store.increment('user:1')).totalHits, 1);
});

test('a new message waits for the previous turn to finish instead of failing straight away', async () => {
  let release;
  const first = withChatLock(ada, () => new Promise((resolve) => { release = resolve; }));
  await new Promise((resolve) => { setTimeout(resolve, 20); });
  const second = withChatLock(ada, async () => 'second ran', { waitMs: 3000 });
  setTimeout(() => release('first'), 300);
  assert.equal(await first, 'first');
  assert.equal(await second, 'second ran');
});
