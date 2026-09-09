import logger from '../../platform/logger.js';
import { retryPendingEmails, retryPendingTransactionalEmails } from './email.service.js';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

function replayOptions(config) {
  return {
    graceMs: config?.email?.retryGraceMs,
    maxAttempts: config?.email?.retryMaxAttempts,
    limit: config?.email?.retryBatchLimit,
  };
}

async function replayOnce(config, deps = {}) {
  const options = replayOptions(config);
  const [ticket, transactional] = await Promise.all([
    retryPendingEmails(config, deps, options),
    retryPendingTransactionalEmails(config, deps, options),
  ]);
  return { ticket, transactional };
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
