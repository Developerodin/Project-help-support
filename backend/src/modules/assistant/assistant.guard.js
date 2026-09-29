import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { ApiError } from '../../platform/errors.js';
import logger from '../../platform/logger.js';

/*
 * Production guardrails that must hold across every backend instance, so they
 * live in Mongo rather than process memory:
 *   - a daily spend cap per user in rupees (chat and voice alike),
 *   - a monthly token budget for the whole workspace, with a warning at 80%,
 *   - one chat request in flight per user,
 *   - the user's last few replies, so read-aloud only speaks what the assistant said.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const BUDGET_WARNING_SHARE = 0.8;
/** Longer than any chat turn can run (six model rounds at 45s would be the worst case). */
const LOCK_MS = 5 * 60 * 1000;
/** How long a new message waits for the previous turn to finish or be cancelled. */
const LOCK_WAIT_MS = 10_000;
const LOCK_POLL_MS = 250;
const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const usageSchema = new mongoose.Schema(
  {
    _id: { type: String }, // "user:<id>:<YYYY-MM-DD>" or "workspace:<YYYY-MM>"
    requests: { type: Number, default: 0 },
    tokens: { type: Number, default: 0 },
    costMicros: { type: Number, default: 0 }, // estimated spend in millionths of a USD
    warnedAt: { type: Date, default: null },
    expireAt: { type: Date, required: true },
  },
  { versionKey: false },
);
usageSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });
export const AssistantUsage = mongoose.models.AssistantUsage || mongoose.model('AssistantUsage', usageSchema);

const lockSchema = new mongoose.Schema(
  {
    _id: { type: String }, // user id
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);
lockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const AssistantLock = mongoose.models.AssistantLock || mongoose.model('AssistantLock', lockSchema);

const replySchema = new mongoose.Schema(
  {
    _id: { type: String }, // user id
    hashes: { type: [String], default: [] }, // newest last
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);
replySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const AssistantReply = mongoose.models.AssistantReply || mongoose.model('AssistantReply', replySchema);

/** A few, since a voice turn can be read aloud after the next one was sent. */
const RECENT_REPLIES = 5;
const REPLY_TTL_MS = 30 * 60 * 1000;
/** The speech route takes at most this many characters; the widget cuts replies to it the same way. */
const SPOKEN_CHARS = 2000;

/** The same for the reply as sent and as the widget sends it back to be spoken. */
const replyHash = (text) => createHash('sha256')
  .update(String(text).slice(0, SPOKEN_CHARS).trim().replace(/\s+/g, ' '))
  .digest('hex');

/** Remembers a reply just sent to this user, so it can be read aloud. */
export async function rememberReply(user, text, now = new Date()) {
  if (!text) return;
  await AssistantReply.updateOne(
    { _id: String(user._id) },
    {
      $push: { hashes: { $each: [replyHash(text)], $slice: -RECENT_REPLIES } },
      $set: { expiresAt: new Date(now.getTime() + REPLY_TTL_MS) },
    },
    { upsert: true },
  );
}

/** Whether `text` is one of the replies recently sent to this user. */
export async function isRecentReply(user, text, now = new Date()) {
  const found = await AssistantReply.findOne({ _id: String(user._id), expiresAt: { $gt: now } }).lean();
  return Boolean(found?.hashes?.includes(replyHash(text)));
}

/** About 15 spoken characters a second, for costing read-aloud from its text. */
const SPEECH_CHARS_PER_MIN = 900;
/**
 * Browser voice notes (opus) run about 2–4 KB a second; assuming 2 KB a second
 * over-estimates their length, so the cap errs on the safe side. Recordings are
 * capped at 60 seconds in the browser, so the estimate is too; WhatsApp voice
 * notes have no such cap and pass their own.
 * ponytail: byte-based estimate; read the duration from the upload if exact
 * voice costing ever matters.
 */
export const estimateAudioSeconds = (bytes, maxSeconds = 60) => Math.min(maxSeconds, Math.max(1, bytes / 2000));

/** Estimated USD cost of one call from what it used. */
export function costUsd(prices, {
  inputTokens = 0, outputTokens = 0, transcribeSeconds = 0, speechChars = 0,
} = {}) {
  return (inputTokens * prices.chatInputPerM) / 1e6
    + (outputTokens * prices.chatOutputPerM) / 1e6
    + (transcribeSeconds / 60) * prices.transcribePerMin
    + (speechChars / SPEECH_CHARS_PER_MIN) * prices.speechPerMin;
}

/** Calendar day and month in the budget's time zone, so India's day resets at midnight IST. */
function periodOf(config, now) {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.assistant.budgetTimeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  return { day, month: day.slice(0, 7) };
}

const dayKey = (userId, day) => `user:${userId}:${day}`;
const monthKey = (month) => `workspace:${month}`;
const budgetMicros = (config) => (config.assistant.userDailyBudgetInr / config.assistant.usdToInr) * 1e6;

/**
 * Refuses a call once the user has spent today's allowance, or the workspace its
 * monthly budget. Checked before the call because its cost is only known after.
 * ponytail: a call already in flight can overshoot the cap by its own cost (at
 * most one chat turn, as chat is one-at-a-time per user). A pre-authorised
 * reservation would close that gap if it ever matters.
 */
export async function checkAllowance(config, user, now = new Date()) {
  const { day, month } = periodOf(config, now);
  const workspace = await AssistantUsage.findById(monthKey(month)).lean();
  if ((workspace?.tokens ?? 0) >= config.assistant.monthlyTokenBudget) {
    throw new ApiError(503, 'ASSISTANT_BUDGET_EXHAUSTED', 'The assistant has used its budget for this month. Ask an admin to raise it.');
  }
  const today = await AssistantUsage.findOneAndUpdate(
    { _id: dayKey(user._id, day) },
    { $inc: { requests: 1 }, $setOnInsert: { expireAt: new Date(now.getTime() + 3 * DAY_MS) } },
    { upsert: true, new: true, lean: true },
  );
  if ((today.costMicros ?? 0) >= budgetMicros(config)) {
    throw new ApiError(
      429,
      'ASSISTANT_DAILY_LIMIT',
      `You have used today's ₹${config.assistant.userDailyBudgetInr} assistant allowance. It resets at midnight.`,
    );
  }
}

/** The next midnight in the budget's time zone: when today's allowance resets. */
function nextMidnight(config, now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: config.assistant.budgetTimeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((part) => [part.type, Number(part.value)]));
  const sinceMidnight = ((parts.hour * 60 + parts.minute) * 60 + parts.second) * 1000 + now.getMilliseconds();
  return new Date(now.getTime() + DAY_MS - sinceMidnight);
}

/**
 * Today's allowance for the usage meter: how much of the rupee limit is spent
 * and when it resets. Read-only; checking it never counts against the cap.
 */
export async function getAllowance(config, user, now = new Date()) {
  const { day } = periodOf(config, now);
  const today = await AssistantUsage.findById(dayKey(user._id, day)).lean();
  const limitInr = config.assistant.userDailyBudgetInr;
  // Whole paise first, so ₹29 doesn't read as 28.999… and show 28%.
  const usedPaise = Math.round(((today?.costMicros ?? 0) / 1e6) * config.assistant.usdToInr * 100);
  return {
    limitInr,
    usedInr: usedPaise / 100,
    percent: Math.min(100, Math.floor(usedPaise / limitInr)),
    resetsAt: nextMidnight(config, now).toISOString(),
  };
}

/**
 * Records what a finished call cost: added to the user's day (in micro-USD, so
 * no float drift) and, for chat tokens, to the workspace's month, with a single
 * warning once 80% of the monthly token budget is used.
 */
export async function recordUsage(config, user, usage, now = new Date()) {
  const { day, month } = periodOf(config, now);
  const costMicros = Math.ceil(costUsd(config.assistant.prices, usage) * 1e6);
  const tokens = (usage.inputTokens || 0) + (usage.outputTokens || 0);
  if (!costMicros && !tokens) return;
  await AssistantUsage.updateOne(
    { _id: dayKey(user._id, day) },
    { $inc: { costMicros, tokens }, $setOnInsert: { expireAt: new Date(now.getTime() + 3 * DAY_MS) } },
    { upsert: true },
  );
  if (!tokens) return;
  const workspace = await AssistantUsage.findOneAndUpdate(
    { _id: monthKey(month) },
    { $inc: { tokens }, $setOnInsert: { expireAt: new Date(now.getTime() + 400 * DAY_MS) } },
    { upsert: true, new: true, lean: true },
  );
  const budget = config.assistant.monthlyTokenBudget;
  if (workspace.tokens < budget * BUDGET_WARNING_SHARE) return;
  // Claim the warning atomically so a busy workspace logs it once, not per request.
  const claimed = await AssistantUsage.updateOne({ _id: monthKey(month), warnedAt: null }, { $set: { warnedAt: now } });
  if (claimed.modifiedCount) {
    logger.warn('assistant: monthly token budget 80% used', { used: workspace.tokens, budget, month });
  }
}

/**
 * Runs `work` while holding this user's chat lock, so turns never run in
 * parallel. A new message waits briefly for the previous turn (an interrupted
 * turn is cancelled server-side and frees the lock within moments) before
 * being refused. The lock expires on its own if a process dies mid-turn.
 */
export async function withChatLock(user, work, { now, waitMs = LOCK_WAIT_MS } = {}) {
  const _id = String(user._id);
  const deadline = Date.now() + waitMs;
  for (;;) {
    const at = now ?? new Date();
    try {
      // Takes a free or expired lock; a live one makes the upsert collide on _id.
      // Sequential on purpose: each attempt waits for the previous one.
      await AssistantLock.findOneAndUpdate(
        { _id, expiresAt: { $lte: at } },
        { $set: { expiresAt: new Date(at.getTime() + LOCK_MS) } },
        { upsert: true },
      );
      break;
    } catch (err) {
      if (err?.code !== 11000) throw err;
      if (Date.now() >= deadline) {
        throw new ApiError(409, 'ASSISTANT_BUSY', 'Still answering your last message. Try again in a moment.');
      }
      await pause(LOCK_POLL_MS);
    }
  }
  try {
    return await work();
  } finally {
    await AssistantLock.deleteOne({ _id }).catch(() => {});
  }
}
