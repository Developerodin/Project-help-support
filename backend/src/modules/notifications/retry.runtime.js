import logger from '../../platform/logger.js';
import { flushDueEmailBatches, retryPendingEmails, retryPendingTransactionalEmails } from './email.service.js';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
// How late a batch can go out past its sendAfter. The batch window is minutes,
// so 30s of slack is invisible; lowering it only buys more empty queries.
const FLUSH_INTERVAL_MS = 30 * 1000;

function replayOptions(config) {
  return {
    graceMs: config?.email?.retryGraceMs,
    maxAttempts: config?.email?.retryMaxAttempts,
    limit: config?.email?.retryBatchLimit,
  };
}

const IDLE = Object.freeze({ attempted: 0, sent: 0, failed: 0 });

// A slow SMTP server can make one sweep outlast the interval. The next tick is
// skipped rather than stacked; the row claims keep a second process safe too.
let sweeping = false;

async function replayOnce(config, deps = {}) {
  if (sweeping) return { ticket: IDLE, transactional: IDLE };
  sweeping = true;
  try {
    const options = replayOptions(config);
    const [ticket, transactional] = await Promise.all([
      retryPendingEmails(config, deps, options),
      retryPendingTransactionalEmails(config, deps, options),
    ]);
    return { ticket, transactional };
  } finally {
    sweeping = false;
  }
}

function shouldLogReplay(result) {
  return result.ticket.attempted > 0 || result.transactional.attempted > 0;
}

export async function replayNotificationOutboxOnBoot(config, deps = {}) {
  if (!config?.features?.email) return;
  try {
    const result = await replayOnce(config, deps);
    if (shouldLogReplay(result)) {
      logger.info('notifications.email_replay_boot', result);
    }
  } catch (err) {
    logger.error('notifications.email_replay_boot_failed', {
      error: err.message,
      stack: err.stack,
    });
  }
}

export function scheduleNotificationOutboxReplay(config, deps = {}) {
  if (!config?.features?.email) return () => {};

  const intervalMs = config?.email?.retryIntervalMs ?? DEFAULT_INTERVAL_MS;
  const schedule = deps.setIntervalFn ?? setInterval;
  const clear = deps.clearIntervalFn ?? clearInterval;

  const handle = schedule(async () => {
    try {
      const result = await replayOnce(config, deps);
      if (shouldLogReplay(result)) {
        logger.info('notifications.email_replay_interval', result);
      }
    } catch (err) {
      logger.error('notifications.email_replay_interval_failed', {
        error: err.message,
        stack: err.stack,
      });
    }
  }, intervalMs);

  handle.unref?.();
  return () => clear(handle);
}

let flushing = false;

/**
 * Sends ticket-email batches whose quiet window has lapsed. Same shape as the
 * replay above: a tick that finds the previous one still running is skipped,
 * and the row claims keep a second process from sending a batch twice.
 */
export function scheduleEmailBatchFlush(config, deps = {}) {
  if (!config?.features?.email) return () => {};

  const schedule = deps.setIntervalFn ?? setInterval;
  const clear = deps.clearIntervalFn ?? clearInterval;

  const handle = schedule(async () => {
    if (flushing) return;
    flushing = true;
    try {
      const result = await flushDueEmailBatches(config, deps, {
        graceMs: config?.email?.retryGraceMs,
        maxAttempts: config?.email?.retryMaxAttempts,
        limit: config?.email?.retryBatchLimit,
      });
      if (result.attempted > 0) logger.info('notifications.email_batch_flush', result);
    } catch (err) {
      logger.error('notifications.email_batch_flush_failed', { error: err.message, stack: err.stack });
    } finally {
      flushing = false;
    }
  }, FLUSH_INTERVAL_MS);

  handle.unref?.();
  return () => clear(handle);
}
