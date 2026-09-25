import './platform/loadEnv.js';
import { readFileSync } from 'node:fs';
import https from 'node:https';
import { loadConfig } from './platform/config.js';
import { connectDb } from './platform/db.js';
import { createApp } from './app.js';
import { seedAdmin, seedProjects, runLegacyMigrations } from './seed.js';
import User from './modules/users/user.model.js';
import { buildInviteDeliverer, buildResetDeliverer } from './modules/notifications/dispatch.js';
import {
  backfillNotificationActivity,
  backfillNotificationProjects,
} from './modules/notifications/notification.service.js';
import logger from './platform/logger.js';
import { retryPendingAuditOutbox } from './modules/rbac/rbac-audit.js';
import {
  replayNotificationOutboxOnBoot,
  scheduleEmailBatchFlush,
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

/** Rows from before notifications carried `project`; a no-op once they all do. */
async function backfillNotificationProjectsOnBoot() {
  try {
    const updated = await backfillNotificationProjects();
    if (updated > 0) logger.info('notifications.project_backfill', { updated });
  } catch (err) {
    logger.error('notifications.project_backfill_failed', { error: err.message, stack: err.stack });
  }
}

/** Rows from before notifications carried `activityAt`; a no-op once they all do. */
async function backfillNotificationActivityOnBoot() {
  try {
    const updated = await backfillNotificationActivity();
    if (updated > 0) logger.info('notifications.activity_backfill', { updated });
  } catch (err) {
    logger.error('notifications.activity_backfill_failed', { error: err.message, stack: err.stack });
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
  if (!config.features.assistant) logger.warn('Assistant disabled — OPENAI_API_KEY not set');
  if (!config.features.push) logger.warn('Push notifications disabled — VAPID keys not set');

  await connectDb(config.mongoUrl);
  await backfillNotificationProjectsOnBoot();
  await backfillNotificationActivityOnBoot();
  await replayAuditOutboxOnBoot();
  await replayNotificationOutboxOnBoot(config);
  const stopAuditReplay = scheduleAuditOutboxReplay();
  const stopNotificationReplay = scheduleNotificationOutboxReplay(config);
  const stopEmailBatchFlush = scheduleEmailBatchFlush(config);
  registerShutdown([stopAuditReplay, stopNotificationReplay, stopEmailBatchFlush]);
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

  const server = config.https
    ? https.createServer({ key: readFileSync(config.https.keyFile), cert: readFileSync(config.https.certFile) }, app)
    : app;
  server.listen(config.port, () => {
    logger.info(`API listening on ${config.https ? 'https' : 'http'} :${config.port} (${config.nodeEnv})`);
  });
}

start().catch((err) => {
  logger.error(`Startup failed: ${err.message}`, { stack: err.stack });
  process.exit(1);
});