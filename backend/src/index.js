import './platform/loadEnv.js';
import { loadConfig } from './platform/config.js';
import { connectDb } from './platform/db.js';
import { createApp } from './app.js';
import { seedAdmin, seedProjects, runLegacyMigrations } from './seed.js';
import User from './modules/users/user.model.js';
import { buildInviteDeliverer, buildResetDeliverer } from './modules/notifications/dispatch.js';
import logger from './platform/logger.js';
import { retryPendingAuditOutbox } from './modules/rbac/rbac-audit.js';
import {
  replayNotificationOutboxOnBoot,
  scheduleNotificationOutboxReplay,
} from './modules/notifications/retry.runtime.js';

const AUDIT_REPLAY_INTERVAL_MS = 5 * 60 * 1000;
const AUDIT_REPLAY_LIMIT = 50;

async function replayAuditOutboxOnBoot() {
  try {
    const result = await retryPendingAuditOutbox({ limit: AUDIT_REPLAY_LIMIT });
    if (result.replayed > 0) {
      logger.info('rbac.audit_outbox_replay_boot', result);
    }
  } catch (err) {
    logger.error('rbac.audit_outbox_replay_boot_failed', {
      error: err.message,
      stack: err.stack,
    });
  }
}

function scheduleAuditOutboxReplay() {
  const handle = setInterval(async () => {
    try {
      const result = await retryPendingAuditOutbox({ limit: AUDIT_REPLAY_LIMIT });
      if (result.replayed > 0) {
        logger.info('rbac.audit_outbox_replay_interval', result);
      }
    } catch (err) {
      logger.error('rbac.audit_outbox_replay_interval_failed', {
        error: err.message,
        stack: err.stack,
      });
    }
  }, AUDIT_REPLAY_INTERVAL_MS);
  handle.unref();
  return () => clearInterval(handle);
}

function registerShutdown(stopFns) {
  const runStop = () => {
    for (const stop of stopFns) {
      try {
        stop();
      } catch (err) {
        logger.error('runtime.stop_hook_failed', { error: err.message });
      }
    }
  };
  process.once('SIGINT', runStop);
  process.once('SIGTERM', runStop);
  process.once('beforeExit', runStop);
}

async function start() {
  const config = loadConfig(process.env);

  if (!config.features.email) logger.warn('Email capability disabled — SMTP group not configured');
  if (!config.features.attachments) logger.warn('Attachment capability disabled — storage group not configured');

  await connectDb(config.mongoUrl);
  await replayAuditOutboxOnBoot();
  await replayNotificationOutboxOnBoot(config);
  const stopAuditReplay = scheduleAuditOutboxReplay();
  const stopNotificationReplay = scheduleNotificationOutboxReplay(config);
  registerShutdown([stopAuditReplay, stopNotificationReplay]);
  await seedAdmin(config);
  // The oldest admin owns the seeded projects; createdBy is required on Project.
  const seedActor = await User.findOne({ role: 'admin' }).sort({ createdAt: 1 });
  if (seedActor) {
    await seedProjects(seedActor);
    await runLegacyMigrations(seedActor);
  }

  const app = createApp(config, {
    deliverInvite: buildInviteDeliverer(config),
    deliverReset: buildResetDeliverer(config),
  });

  app.listen(config.port, () => {
    logger.info(`API listening on :${config.port} (${config.nodeEnv})`);
  });
}

start().catch((err) => {
  logger.error(`Startup failed: ${err.message}`, { stack: err.stack });
  process.exit(1);
});