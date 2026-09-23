import mongoose from 'mongoose';
import { ApiError } from '../../platform/errors.js';
import logger from '../../platform/logger.js';

/*
 * Production guardrails that must hold across every backend instance, so they
 * live in Mongo rather than process memory:
 *   - a daily spend cap per user in rupees (chat and voice alike),
 *   - a monthly token budget for the whole workspace, with a warning at 80%,
 *   - one chat request in flight per user.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const BUDGET_WARNING_SHARE = 0.8;
/** Longer than any chat turn can run (six model rounds at 45s would be the worst case). */
const LOCK_MS = 5 * 60 * 1000;

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

/** About 15 spoken characters a second, for costing read-aloud from its text. */
const SPEECH_CHARS_PER_MIN = 900;
/**
 * Browser voice notes (opus) run about 2–4 KB a second; assuming 2 KB a second
 * over-estimates their length, so the cap errs on the safe side. Recordings are
 * capped at 60 seconds in the browser, so the estimate is too.
 * ponytail: byte-based estimate; read the duration from the upload if exact
 * voice costing ever matters.
 */
export const estimateAudioSeconds = (bytes) => Math.min(60, Math.max(1, bytes / 2000));

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
 * Runs `work` while holding this user's chat lock, so a second message sent
 * before the first is answered is refused instead of running in parallel. The
 * lock expires on its own if a process dies mid-turn.
 */
export async function withChatLock(user, work, now = new Date()) {
  const _id = String(user._id);
  try {
    // Takes a free or expired lock; a live one makes the upsert collide on _id.
    await AssistantLock.findOneAndUpdate(
      { _id, expiresAt: { $lte: now } },
      { $set: { expiresAt: new Date(now.getTime() + LOCK_MS) } },
      { upsert: true },
    );
  } catch (err) {
    if (err?.code === 11000) {
      throw new ApiError(409, 'ASSISTANT_BUSY', 'Still answering your last message. Try again in a moment.');
    }
    throw err;
  }
  try {
    return await work();
  } finally {
    await AssistantLock.deleteOne({ _id }).catch(() => {});
  }
}
